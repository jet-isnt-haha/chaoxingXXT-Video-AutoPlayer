const axios = require('axios')
const puppeteer = require('puppeteer');
const md5 = require('md5');
const {user,pwd,encSrcData,userAgent,baseURL,courseId,classId,prefixURL,outputLog,requestHeaders} =require('./config');


/* 超新星学习通脚本 */

//IIEF函数内实现
(async ()=>{
    //启动浏览器
    const broswer = await puppeteer.launch({
        headless:true,//关闭无头模式以便调试
        args:['--no-sandbox','--disable-setuid-sandx']//用于绕过操作系统沙盒限制（常见于 Linux 或某些 CI 环境）。它们不直接影响 UI，但确保浏览器能正常启动。
    })
    //记录控制台输出
    outputLog();
    //控制浏览器打开新标签页
    const page = await broswer.newPage();

    //调整视窗
    await page.setViewport({width: 1920, height: 1080, deviceScaleFactor: 1 })

    //设置用户代理（模拟真实环境）
    await page.setUserAgent(userAgent)

    //进入网站
    await page.goto(baseURL,{waitUntil:'networkidle0'});

    //登录网页并进入个人中心
    await  loginXXT(user,pwd,page)

    //进入相应课程并获取当前url下的cpi字段
    await enterCourse(page,classId,courseId);

    //选择第一章第一个进入学习
    await enterFirstCourse(page);

    //开始运行脚本
    await startScript(page,encSrcData,prefixURL,requestHeaders)

    broswer.close();
})();


//开始运行脚本
async function startScript(page,encSrcData,prefixURL,requestHeaders){

//当前脚本运行位置（具体课程位置）
let curIndex = '0-0-0'

const cells = await page.$$('.showcontent .thiscontent .onetoone .cells');

for(let k =0;k<cells.length;++k){
    const ncells = await cells[k].$$('.ncells');

    for(let j =0;j<ncells.length;++j ){
    let _span =  await ncells[j].$('[id^="cur"] span[onclick]');

    await page.evaluate( (el)=>{
      el.click();

    },_span)

    page.waitForNavigation({waitUntil:'networkidle0'});

    await new Promise((r) => setTimeout(r, 3000));

    await page.waitForSelector('.left .content .main .tabtags span',{timeout:100000});

    const spanLists = await page.$$('.left .content .main .tabtags span');

        for(let i = 0;i<spanLists.length;++i){
            curIndex=`第${k}章-第${j+1}节-${i+1}`

        if(spanLists.length>1){
        await spanLists[i].click();
    }


    await new Promise((r) => setTimeout(r, 3000));


    await playAndGetURL(page,encSrcData,prefixURL,curIndex,requestHeaders);
            }
        }
    }

console.log('脚本运行完毕');
}

//选择进入第一章第一节
async function  enterFirstCourse(page) {
        const firstUnit = await page.$('.main .left .content1 .timeline .units ');
    if(firstUnit){
    const aHref = await firstUnit.$eval('.leveltwo h3.clearfix a',el=>el.href);

    await page.goto(aHref,{waitUntil:'networkidle2'});
    }
}

//进入课程
async function enterCourse(page,classId,courseId){

    const targetFrameHandle = await page.$('.con .con-right.style3 .center iframe#frame_content')
    const targetFrame = await targetFrameHandle.contentFrame();
    const targetLi = await targetFrame.$(`.Wrapbody .zmodel ul.clearfix li.courseItem:has(input[name="courseId"][value="${courseId}"])`+`:has(input[name="classId"][value="${classId}"])`)
    if(targetLi){
        const aHref = await targetLi.$eval('div.Mcon1img.httpsClass a',el=>el.href);

        await page.goto(aHref,{waitUntil:'networkidle2'})
    // 或者使用Promise.all的写法（适用于通过点击等方式触发导航）
    // await Promise.all([
    //   page.waitForNavigation({ waitUntil: 'networkidle2' }),
    //   page.goto(aHref)
    // ]);
    //         networkidle0：等待网络请求数为 0（没有活跃请求）。
    //networkidle2：等待网络请求数 ≤2（适用于有少量长连接的场景，如 WebSocket）。
}
}

//获取网络请求完成播放
async function setPassToTrue(enc,encSrcData,url,cookieString,page,requestHeaders){
    //处理api
    const originUrl = new URL(url);
    originUrl.searchParams.set('playingTime',encSrcData.duration);
    originUrl.searchParams.set('enc',enc);
     originUrl.searchParams.set('isdrag','4');
    let passedUrl = originUrl.toString();
    const option ={
        method:'GET',
        headers:{
      ...requestHeaders,
      'Cookie': cookieString,
        }
    }
    //循环发送破译请求
    while(1){
        let flag = false;
    await axios.get(passedUrl,option).then((res)=>{
        console.log(res.data);
        flag=res.data.isPassed;
        console.log('尝试解密中');
    }).catch(err=>{
        console.log('错误error',err);
    })
    if(flag){
        console.log('解密成功');
        break;
    }else{
        console.log('本次解密失败');
    }
    await new Promise((r)=>setTimeout(r,4000));
}
}

//获取播放完成的加密数据
async  function gainEncryption(encSrcData){
     let str = `[${encSrcData.clazzId}][${encSrcData.userid}][${encSrcData.jobid}][${encSrcData.objectId}][${encSrcData.playingTime*1000}][d_yHJ!$pdA~5][${encSrcData.duration*1000}][${encSrcData.clipTime}]`;
    return md5(str);
}

//播放视频获取url进行检查或解密
async function playAndGetURL(page,encSrcData,prefixURL,curIndex,requestHeaders){
 // 等待外层 DOM 加载
   try {
    await page.waitForSelector('.left .content .main .course_main', { timeout: 10000 });

    // 找到第一个 iframe（class="course_main" 下的 iframe）
    await page.waitForSelector('.course_main iframe', { timeout: 10000 });
    const frame1Handle = await page.$('.course_main iframe');
    const frame1 = await frame1Handle.contentFrame();

    // 在第一个 iframe 中定位 .wrap .ans-cc .editor-iframe 下的第二个 iframe
  
    await frame1.waitForSelector('.wrap .ans-cc p.editor-iframe #ext-gen1050 iframe.ans-attach-online.ans-insertvideo-online', { timeout: 10000 });
    const frame2Handle = await frame1.$('.wrap .ans-cc p.editor-iframe #ext-gen1050 iframe.ans-attach-online.ans-insertvideo-online');

/*     if (!frame2Handle) {
        console.log('frame2Handle 未找到');
        return;
    } */
    const frame2 = await frame2Handle.contentFrame();
/*     if (!frame2) {
        console.log('frame2 未获取到');
        return;
    }  */

    // 在第二个 iframe 中定位并点击按钮
    await frame2.waitForSelector('.main.clearfix .prev_video_left .fullScreenContainer #reader #video button', { timeout: 100000 });
  
    console.log('已找到播放按键点击以获取请求');
    const btn = await frame2.$('.main.clearfix .prev_video_left .fullScreenContainer #reader #video button');
    if (btn) {
        await btn.click();
    } else {
        console.log('按钮未找到，无法点击');
        return;
    }
    }catch (error) {
    // 处理其他类型的错误
    console.error('未知的错误:当前页面没有视频可以打开,进入下一个小节', error);
    return;
}
    //获取url并检测是否已经完成播放若是则跳过
    const reqUrl = {
        _url:-1
    }
    const reqPrmoise =page.waitForRequest((req)=>req.method() === 'GET' && req.url().startsWith(prefixURL),{timeout:100000})

    reqUrl._url=(await reqPrmoise).url()

        
    const cookieString = await getCookies(page);

    const res= await axios.get(reqUrl._url,{
        method:'GET',
        headers:{
           'Connection': requestHeaders.Connection,
            'Content-Type': requestHeaders.ContentType,
            'Accept': requestHeaders.Accept,
            'cookie':cookieString,
            'Host': requestHeaders.Host,
           'Accept-Encoding':requestHeaders.AcceptEncoding,
            'User-Agent': requestHeaders.UserAgent,
        }})
        if(res.data.isPassed){
             console.log(curIndex,'已学习完成');
        }else{
            console.log(curIndex,'还未学习进行解密');
        //若还没学习则进行解密
  const {clazzId,duration,clipTime,objectId,userid,jobid} =Object.fromEntries(((new URL(reqUrl._url)).searchParams));
    encSrcData.clazzId=clazzId;
    encSrcData.duration=duration;
    encSrcData.clipTime=clipTime;
    encSrcData.objectId=objectId;
    encSrcData.userid=userid;
    encSrcData.jobid=jobid;
    encSrcData.playingTime=duration;
    const enc = await gainEncryption(encSrcData);
    await setPassToTrue(enc,encSrcData,reqUrl._url,cookieString,page,requestHeaders);
    }

}

//登录网页逻辑
async function loginXXT(user,pwd,page){
    //等待用户名输入框加载
    await page.waitForSelector('#phone',{timeout:10000});

    //输入用户名和密码
    console.log(user,pwd);
    await page.evaluate((user,pwd)=>{
        document.querySelector('#phone').value = user;
        document.querySelector('#pwd').value = pwd;
    },user,pwd)

    //点击登录按钮
    await page.click('#loginBtn');

    await page.waitForNavigation({waitUntil:'networkidle0'});
}

//获取cookies
async function getCookies(page){
    const cookies = await page.cookies();
    cookies.push({name:'source',value:'num3'},{name:'orgfid',value:'43843'},{name:'thirdRegist',value:'0'})
    const cookieString = cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join(';');
    return cookieString;
}