const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const md5 = require('md5');
const { user, pwd, userAgent, baseURL, courseId, classId, outputLog } = require('./config');
const { solveExercise } = require('./exercise');

/* 超新星学习通脚本（适配 2025/2026 版 mooc2-ans 页面） */

//播放完成后上报接口的路径特征（兼容 mooc1 / mooc1-2 / mooc2 等不同域名）
const LOG_URL_RE = /\/multimedia\/log\/a\//;
//课程列表页（新版页面入口）
const COURSE_LIST_URL = 'https://mooc1.chaoxing.com/visit/interaction';
//md5 算法盐值
const SALT = process.env.SALT || 'd_yHJ!$pdA~5';
//单个视频最多等待多久（在视频时长基础上额外放宽的秒数）
const EXTRA_WAIT_SECONDS = 300;

const sleep = ms => new Promise(r => setTimeout(r, ms));

//超星域名偶发 ERR_CONNECTION_CLOSED / ERR_ABORTED，带重试地打开页面
async function gotoWithRetry(page, url, options = {}, retries = 3){
    for (let i = 0; i < retries; i++) {
        try {
            return await page.goto(url, options);
        } catch (e) {
            const msg = String(e.message).split('\n')[0];
            console.log(`页面加载失败(${i + 1}/${retries}): ${msg}`);
            if (i === retries - 1) { throw e; }
            await sleep(3000);
        }
    }
}

//优先使用本机已安装的浏览器，避免 Puppeteer 自带的 Chrome 未下载导致启动失败
function resolveBrowserPath(){
    if(process.env.PUPPETEER_EXECUTABLE_PATH){return process.env.PUPPETEER_EXECUTABLE_PATH;}
    const candidates = [
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser'
    ];
    return candidates.find(p=>p && fs.existsSync(p));
}

//记录页面中的视频上报请求
function collectLogRequests(page, bucket){
    page.on('request', req => {
        const url = req.url();
        if (LOG_URL_RE.test(url)) {
            bucket.push(url);
        }
    });
}

async function loginXXT(page){
    await gotoWithRetry(page, baseURL, {waitUntil:'networkidle2', timeout:60000});

    //已经登录过会直接进入个人空间
    if (await page.$('#phone')) {
        await page.evaluate((user,pwd)=>{
            document.querySelector('#phone').value = user;
            document.querySelector('#pwd').value = pwd;
        }, user, pwd);

        await Promise.all([
            page.waitForNavigation({waitUntil:'networkidle2', timeout:60000}).catch(()=>{}),
            page.click('#loginBtn')
        ]);
    } else {
        console.log('检测到已登录，跳过登录步骤');
    }
    console.log('登录完成，当前地址:', page.url());
}

//进入课程并打开“章节”标签页，返回章节 iframe 以及进入章节所需的 enc/cpi
async function enterChapterTab(page){
    await gotoWithRetry(page, COURSE_LIST_URL, {waitUntil:'networkidle2', timeout:60000});
    await page.waitForFunction(
        () => [...document.querySelectorAll('a')].some(a => a.href.includes('courseid=')),
        {timeout:30000}
    );

    const href = await page.evaluate((courseId, classId) => {
        const link = [...document.querySelectorAll('a')].find(a =>
            a.href.includes(`courseid=${courseId}`) && a.href.includes(`clazzid=${classId}`)
        );
        return link ? link.href : null;
    }, courseId, classId);

    if (!href) {
        throw new Error(`课程列表中没有找到 courseId=${courseId}、classId=${classId} 的课程，请检查 .env 配置`);
    }

    await gotoWithRetry(page, href, {waitUntil:'networkidle2', timeout:60000});
    console.log('已进入课程页面:', page.url());

    await page.waitForFunction(
        () => [...document.querySelectorAll('li')].some(li => li.innerText.trim() === '章节'),
        {timeout:30000}
    );
    await page.evaluate(() => {
        const li = [...document.querySelectorAll('li')].find(li => li.innerText.trim() === '章节');
        (li.querySelector('a') || li).click();
    });

    await page.waitForSelector('#frame_content-zj', {timeout:30000});
    const frame = await (await page.$('#frame_content-zj')).contentFrame();
    await frame.waitForSelector('.chapter_item[id^="cur"]', {timeout:30000});
    //toOld() 里包含进入旧版章节页所需的 enc / cpi
    await frame.waitForFunction(() => typeof window.toOld === 'function', {timeout:30000});

    const meta = await frame.evaluate(() => {
        const source = window.toOld.toString();
        return {
            enc: (source.match(/enc\s*=\s*"([^"]+)"/) || [])[1],
            cpi: (source.match(/cpi\s*=\s*(\d+)/) || [])[1],
            domain: (window.ServerHost && window.ServerHost.mooc1Domain) || 'https://mooc1.chaoxing.com'
        };
    });

    if (!meta.enc || !meta.cpi) {
        throw new Error('未能从章节页面解析出 enc / cpi，超星页面结构可能又变了');
    }
    return {frame, meta};
}

//查找下一个“已解锁”的小节（新版页面只给当前可学习的节点绑定 onclick）
async function findNextPoint(frame, processed){
    return frame.evaluate((processedList) => {
        const done = new Set(processedList);
        const items = [...document.querySelectorAll('.chapter_item[id^="cur"]')];
        const describe = (item) => {
            const name = ((item.innerText || '').trim().replace(/\s+/g, ' '))
                .replace(/\d*个待完成任务点.*$/, '')
                .replace(/\s+\d+$/, '')
                .trim();
            return {kid: item.id.replace(/^cur/, ''), name};
        };

        for (const item of items) {
            const rawText = (item.innerText || '').trim().replace(/\s+/g, ' ');
            const point = describe(item);
            if (!point.kid || done.has(point.kid)) { continue; }
            if (!item.hasAttribute('onclick')) { continue; }
            //已完成的小节仍然带 onclick，但不再显示剩余任务数（如“1.2 xxx 2”）
            if (!/个待完成任务点/.test(rawText) && !/\s+[1-9]\d*$/.test(rawText)) { continue; }
            if (/练习|试卷|测验|作业|考试/.test(point.name)) {
                return {...point, unsupported: true};
            }
            return point;
        }
        return null;
    }, [...processed]);
}

function buildChapterUrl(meta, kid){
    const params = new URLSearchParams({
        chapterId: kid,
        courseId,
        clazzid: classId,
        cpi: meta.cpi,
        enc: meta.enc,
        mooc2: '1',
        hidetype: '0',
        fanyaVersion: '0'
    });
    return `${meta.domain}/mycourse/studentstudy?${params.toString()}`;
}

//打开某个小节，返回承载视频的 cards iframe
async function openKnowledgePoint(page, meta, point){
    await gotoWithRetry(page, buildChapterUrl(meta, point.kid), {waitUntil:'domcontentloaded', timeout:60000});
    try {
        await page.waitForSelector('#iframe', {timeout:30000});
    } catch (e) {
        const text = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '');
        console.log('  页面未加载出内容:', text.replace(/\s+/g, ' '));
        return null;
    }
    const cards = await (await page.$('#iframe')).contentFrame();
    if (!cards) { return null; }
    return cards;
}

//尝试秒过/补发完成上报：直接把 playingTime 上报为总时长
async function tryFastPass(page, logUrl, action = '秒过'){
    try {
        const params = new URL(logUrl).searchParams;
        const clazzId = params.get('clazzId');
        const userid = params.get('userid');
        const jobid = params.get('jobid');
        const objectId = params.get('objectId');
        const duration = Number(params.get('duration'));
        if (!clazzId || !userid || !jobid || !objectId || !duration) { return false; }

        const enc = md5(`[${clazzId}][${userid}][${jobid}][${objectId}][${duration * 1000}][${SALT}][${duration * 1000}][0_${duration}]`);
        const target = new URL(logUrl);
        target.searchParams.set('playingTime', String(duration));
        target.searchParams.set('clipTime', `0_${duration}`);
        target.searchParams.set('isdrag', '4');
        target.searchParams.set('enc', enc);
        target.searchParams.set('_t', String(Date.now()));

        const text = await page.evaluate(async (url) => {
            try {
                const res = await fetch(url, {credentials:'include'});
                return await res.text();
            } catch (e) {
                return '';
            }
        }, target.toString());

        const passed = /"isPassed"\s*:\s*true/.test(text);
        console.log(passed ? `  ${action}成功` : `  ${action}失败（返回：${text.slice(0,80)}）`);
        return passed;
    } catch (e) {
        console.log(`  ${action}异常:`, e.message);
        return false;
    }
}

//重新定位某个知识点下的第 index 个视频 iframe（页面/播放器刷新后使用）
async function findVideoFrame(page, index){
    try {
        const cardsHandle = await page.$('#iframe');
        if (!cardsHandle) { return null; }
        const cards = await cardsHandle.contentFrame();
        if (!cards) { return null; }
        const handles = await cards.$$('iframe.ans-insertvideo-online');
        const handle = handles[index] || handles[0];
        if (!handle) { return null; }
        return (await handle.contentFrame()) || null;
    } catch (e) {
        return null;
    }
}

//新版播放器默认只允许一个视频播放；这里移除暂停调用，让同一知识点的多个视频可以并行播放
function prepareFrameInPage(){
    const proto = HTMLMediaElement.prototype;
    if (!proto.__autoPlayerPausePatched) {
        proto.__autoPlayerPausePatched = true;
        proto.pause = function(){};
    }
    const video = document.querySelector('video');
    if (video) {
        video.muted = true;
        //进度已到结尾但任务点未通过时，从头播放以重新产生学习上报
        if (video.ended || (isFinite(video.duration) && video.duration > 0 && video.currentTime >= video.duration - 1)) {
            try { video.currentTime = 0; } catch (e) {}
        }
        if (video.paused) { video.play().catch(()=>{}); }
    }
    const btn = document.querySelector('.vjs-big-play-button');
    if (btn) { btn.click(); }
}

async function prepareVideoFrame(frame){
    await frame.waitForSelector('video', {timeout:20000}).catch(()=>{});
    await frame.evaluate(prepareFrameInPage).catch(()=>{});
    await sleep(1000);
}

//学习一个知识点下的所有视频（多个视频并行播放，节省总时长）
async function studyKnowledgePoint(page, meta, point, logUrls){
    console.log(`\n[${point.name}]`);
    const cards = await openKnowledgePoint(page, meta, point);
    if (!cards) {
        console.log('  页面未加载出内容，跳过');
        return;
    }

    let videoHandles = [];
    try {
        await cards.waitForSelector('iframe.ans-insertvideo-online', {timeout:10000});
        videoHandles = await cards.$$('iframe.ans-insertvideo-online');
    } catch (e) {
        console.log('  无视频任务点（可能是练习/文档），跳过');
        return;
    }

    //读取任务点信息，用于判断哪些视频已经学完
    const attachments = await cards.evaluate(() => {
        try {
            return (window.mArg && window.mArg.attachments || []).map(a => ({
                objectId: a.objectId,
                duration: Number(a.attDuration) || 0,
                playTime: Number(a.playTime) || 0,
                isPassed: a.isPassed === true || a.isPassed === 'true' || a.isPassed === 1
            }));
        } catch (e) {
            return [];
        }
    }).catch(() => []);

    const pointLogStart = logUrls.length;
    const active = [];

    for (let i = 0; i < videoHandles.length; i++) {
        const frame = await videoHandles[i].contentFrame();
        if (!frame) { continue; }
        await frame.waitForSelector('video', {timeout:20000}).catch(()=>{});
        const ids = await frame.evaluate(() => ({
            objectId: window.videoObjectId || '',
            jobId: window.videoJobId || ''
        })).catch(() => null);
        if (!ids) { continue; }

        const attachment = attachments.find(a => a.objectId === ids.objectId);
        if (attachment && attachment.duration) {
            const watched = attachment.playTime / 1000;
            //只有服务端明确标记 isPassed 才算完成；playTime 到了结尾但未通过时仍需重新上报
            if (attachment.isPassed) {
                console.log(`  视频${i + 1}已通过（${Math.round(watched)}/${attachment.duration}s），跳过`);
                continue;
            }
            if (watched >= attachment.duration - 2) {
                console.log(`  视频${i + 1}进度已到结尾但任务点未通过，重新上报完成`);
            } else {
                console.log(`  视频${i + 1}：已观看 ${Math.round(watched)}/${attachment.duration}s，继续播放`);
            }
        }

        await prepareVideoFrame(frame);
        active.push({
            index: i,
            frame,
            jobId: ids.jobId,
            duration: (attachment && attachment.duration) || 0,
            done: false
        });
    }

    if (!active.length) {
        console.log('  该知识点的视频都已学完');
        return;
    }
    console.log(`  开始并行播放 ${active.length} 个视频`);

    //等待每个视频产生第一条上报，顺便尝试秒过（未开防拖拽的课程可以直接完成）
    const wantJobs = new Set(active.map(a => a.jobId).filter(Boolean));
    const preDeadline = Date.now() + 20000;
    while (Date.now() < preDeadline) {
        const gotJobs = new Set(logUrls.slice(pointLogStart).map(u => new URL(u).searchParams.get('jobid')));
        if ([...wantJobs].every(jobid => gotJobs.has(jobid))) { break; }
        await sleep(1000);
    }

    let latestByJob = new Map();
    for (const url of logUrls.slice(pointLogStart)) {
        const jobid = new URL(url).searchParams.get('jobid');
        if (jobid) { latestByJob.set(jobid, url); }
    }
    for (const item of active) {
        const url = item.jobId ? latestByJob.get(item.jobId) : null;
        if (url && await tryFastPass(page, url, '秒过')) {
            item.done = true;
        }
    }
    if (active.every(a => a.done)) {
        console.log('  所有视频秒过成功');
        return;
    }

    const startTime = Date.now();
    let maxDuration = Math.max(...active.map(a => a.duration || 0), 0);
    let tick = 0;
    let lastProgressLog = 0;

    while (true) {
        await sleep(5000);
        tick++;

        //定期把页面拉到前台并移动鼠标，避免被判定为“离开页面/长时间无操作”
        if (tick % 4 === 0) {
            await page.bringToFront().catch(()=>{});
            await page.mouse.move(500 + Math.floor(Math.random() * 300), 400 + Math.floor(Math.random() * 200)).catch(()=>{});
        }

        for (const item of active) {
            if (item.done) { continue; }
            let state = null;
            try {
                state = await item.frame.evaluate(() => {
                    const v = document.querySelector('video');
                    return v ? {
                        current: v.currentTime,
                        duration: v.duration,
                        paused: v.paused,
                        ended: v.ended
                    } : null;
                });
            } catch (e) {
                //播放器刷新后重新定位
                const refreshed = await findVideoFrame(page, item.index);
                if (!refreshed) {
                    console.log(`  视频${item.index + 1}的播放器已丢失，跳过`);
                    item.done = true;
                } else {
                    item.frame = refreshed;
                    await prepareVideoFrame(refreshed);
                }
                continue;
            }

            if (!state) { item.done = true; continue; }
            if (state.duration && state.duration > maxDuration) { maxDuration = state.duration; }
            if (state.ended || (state.duration && state.current >= state.duration - 0.5)) {
                item.done = true;
                continue;
            }
            if (state.paused) {
                await item.frame.evaluate(() => {
                    const v = document.querySelector('video');
                    if (v && v.paused) { v.play().catch(()=>{}); }
                }).catch(()=>{});
            }
        }

        if (Date.now() - lastProgressLog >= 60000) {
            lastProgressLog = Date.now();
            const progress = [];
            for (const item of active) {
                if (item.done) { progress.push('已完成'); continue; }
                try {
                    const current = await item.frame.evaluate(() => {
                        const v = document.querySelector('video');
                        return v ? Math.floor(v.currentTime) : 0;
                    });
                    progress.push(`${current}/${Math.floor(item.duration || 0)}s`);
                } catch (e) {}
            }
            if (progress.length) { console.log('    播放进度：', progress.join(' | ')); }
        }

        if (active.every(a => a.done)) {
            console.log('  所有视频播放结束');
            break;
        }

        if (Date.now() - startTime > (maxDuration + EXTRA_WAIT_SECONDS) * 1000) {
            console.log('  等待视频播放超时，进入下一个知识点');
            break;
        }
    }

    //等待播放结束后的最后一次上报
    await sleep(10000);
    const icons = await cards.evaluate(() =>
        [...document.querySelectorAll('.ans-job-icon')].map(e => e.className)
    ).catch(() => []);
    console.log('  任务点状态:', icons.join(' | ') || '未知');

    //按 jobid 分组，对每个视频补发一次完成上报（此时真实观看时长已经满足要求）
    latestByJob = new Map();
    for (const url of logUrls.slice(pointLogStart)) {
        const jobid = new URL(url).searchParams.get('jobid');
        if (jobid) { latestByJob.set(jobid, url); }
    }
    for (const [jobid, url] of latestByJob) {
        await tryFastPass(page, url, '完成上报');
    }
}

(async ()=>{
    const browser = await puppeteer.launch({
        headless:true,
        executablePath: resolveBrowserPath(),
        args:[
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--autoplay-policy=no-user-gesture-required',
            '--mute-audio',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    });

    outputLog();

    try {
        const page = await browser.newPage();
        await page.setViewport({width: 1920, height: 1080, deviceScaleFactor: 1});
        await page.setUserAgent(userAgent);
        page.on('dialog', async dialog => {
            try { await dialog.dismiss(); } catch (e) {}
        });

        const logUrls = [];
        collectLogRequests(page, logUrls);

        await loginXXT(page);

        //新版课程按顺序解锁：只有当前可学习的知识点才带 onclick。
        //因此每学完一个知识点就重新打开章节页，获取下一个已解锁节点。
        const processed = new Set();
        let round = 0;
        while (true) {
            const {frame, meta} = await enterChapterTab(page);
            const next = await findNextPoint(frame, processed);

            if (!next) {
                console.log('没有更多已解锁的知识点了（可能已完成，或后续章节尚未开放）');
                if (processed.size) {
                    console.log('提示：如果页面中仍有未完成的内容，说明上一个知识点还有任务点未通过，请查看上面的日志');
                }
                break;
            }
            if (next.unsupported) {
                round++;
                const ok = await solveExercise(page, meta, next, openKnowledgePoint);
                if (!ok) {
                    console.log(`练习题「${next.name}」未能完成，脚本停止`);
                    break;
                }
                processed.add(next.kid);
                console.log(`已完成第 ${round} 个待学习小节：${next.name}`);
                continue;
            }

            round++;
            await studyKnowledgePoint(page, meta, next, logUrls);
            processed.add(next.kid);
            console.log(`已完成第 ${round} 个待学习小节：${next.name}`);
        }

        console.log('\n脚本运行完毕');
    } catch (e) {
        console.error('脚本运行出错:', e);
    } finally {
        await browser.close();
    }
})();
