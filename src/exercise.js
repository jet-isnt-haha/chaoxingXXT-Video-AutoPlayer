const { buildMapping, decodeText } = require('./fontDecoder');
const { answerQuestions } = require('./deepseek');
const { deepseekApiKey } = require('./config');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function cleanText(text){
    return String(text || '').replace(/\s+/g, ' ').trim();
}

//等待并定位练习题 iframe
async function waitForWorkFrame(page, timeout = 30000){
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const frame = page.frames().find(f => f.url().includes('doHomeWorkNew'));
        if (frame) { return frame; }
        await sleep(1000);
    }
    return null;
}

//从页面提取字体和题目（题目文字此时还是混淆状态）
async function extractWork(frame){
    return frame.evaluate(() => {
        let base64 = '';
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    if (rule.type === CSSRule.FONT_FACE_RULE && /font-cxsecret/.test(rule.style.getPropertyValue('font-family'))) {
                        const m = rule.style.getPropertyValue('src').match(/base64,([^"')]+)/);
                        if (m) { base64 = m[1]; }
                    }
                }
            } catch (e) {}
        }

        const questions = [...document.querySelectorAll('.TiMu')].map((q, index) => {
            const titleEl = q.querySelector('.Zy_TItle');
            const optionEls = [...q.querySelectorAll('.Zy_ulTop > li')];
            const options = optionEls.map(li => {
                const span = li.querySelector('.num_option, .num_option_dx');
                const body = li.querySelector('a.after') || li;
                return {
                    letter: span ? (span.getAttribute('data') || '') : '',
                    text: body.innerText.replace(/\s+/g, ' ').trim(),
                    qtype: li.getAttribute('qtype') || '',
                    qid: li.getAttribute('qid') || '',
                };
            });
            const textarea = q.querySelector('textarea');
            const fillName = textarea ? (textarea.name || '') : '';
            const fillMatch = fillName.match(/answerEditor(\d+)/);
            const first = optionEls[0];
            return {
                index,
                qid: options[0] ? options[0].qid : (fillMatch ? fillMatch[1] : ''),
                fillQid: fillMatch ? fillMatch[1] : '',
                qtype: first ? (first.getAttribute('qtype') || '0') : 'fill',
                title: titleEl ? titleEl.innerText : '',
                options,
            };
        });
        return { base64, questions };
    });
}

//把页面上的混淆文字解码成真实文字
async function decodeQuestions(frame, raw, mapping){
    return raw.questions.map(q => {
        const title = decodeText(q.title, mapping);
        const options = q.options.map(o => ({
            ...o,
            text: decodeText(o.text, mapping),
        }));
        let type = 'single';
        let qid = q.qid;
        if (q.fillQid) {
            type = 'fill';
            qid = q.fillQid.endsWith('1') ? q.fillQid.slice(0, -1) : q.fillQid;
        } else if (q.qtype === '1') {
            type = 'multi';
        } else if (q.qtype === '3') {
            type = 'judge';
        }
        return { ...q, title: cleanText(title), options, type, qid };
    });
}

//应用答案
async function applyAnswers(frame, questions, answers){
    return frame.evaluate((qs, ans) => {
        const result = { applied: 0, failed: [], details: [] };

        function optionLis(qid){
            return [...document.querySelectorAll(`li[qid="${qid}"]`)];
        }

        for (const q of qs) {
            const answer = ans[q.qid];
            if (answer === undefined || answer === null || answer === '') {
                result.failed.push({ qid: q.qid, reason: '没有答案' });
                continue;
            }

            if (q.type === 'fill') {
                const editor = window['answerEditor' + q.qid + '_1'];
                if (!editor || typeof editor.setContent !== 'function') {
                    result.failed.push({ qid: q.qid, reason: '未找到填空编辑器' });
                    continue;
                }
                const text = Array.isArray(answer) ? answer.join('') : String(answer);
                const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                editor.setContent('<p>' + safe + '</p>');
                if (typeof editor.sync === 'function') { editor.sync(); }
                result.applied++;
                continue;
            }

            const lis = optionLis(q.qid);
            if (!lis.length) {
                result.failed.push({ qid: q.qid, reason: '未找到选项' });
                continue;
            }

            let letters = [];
            if (q.type === 'multi') {
                letters = Array.isArray(answer) ? answer : String(answer).replace(/[^A-Za-z]/g, '').split('');
            } else if (q.type === 'judge') {
                const a = String(answer).trim();
                letters = /^(对|正确|true|是|A)$/i.test(a) ? ['true'] : ['false'];
            } else {
                letters = [String(answer).trim().replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase()];
            }

            //先清空已选中的选项
            for (const li of lis) {
                const span = li.querySelector('.num_option, .num_option_dx');
                if (span && (span.classList.contains('check_answer') || span.classList.contains('check_answer_dx'))) {
                    span.click();
                }
            }

            let ok = true;
            for (const letter of letters) {
                const li = lis.find(item => {
                    const span = item.querySelector('.num_option, .num_option_dx');
                    return span && span.getAttribute('data') === letter;
                });
                if (!li) { ok = false; continue; }
                const span = li.querySelector('.num_option, .num_option_dx');
                span.click();
            }
            if (ok) {
                result.applied++;
            } else {
                result.failed.push({ qid: q.qid, reason: '选项字母未匹配: ' + letters.join(',') });
            }
        }

        if (typeof updateAllFillinBlanksData === 'function') {
            try { updateAllFillinBlanksData(); } catch (e) {}
        }
        return result;
    }, questions, answers);
}

//提交练习
async function submitWork(page, frame){
    const responsePromise = page.waitForResponse(
        res => /addStudentWorkNew(Web)?/.test(res.url()) && res.request().method() === 'POST',
        {timeout: 60000}
    ).catch(() => null);

    await frame.evaluate(() => {
        try { if (typeof submitLock !== 'undefined') { submitLock = 0; } } catch (e) {}
        //走页面正常提交流程：验证 -> 确认弹窗 -> 提交
        if (typeof btnBlueSubmit === 'function') {
            btnBlueSubmit();
        } else {
            const btn = document.querySelector('.btnSubmit');
            if (btn) { btn.click(); }
        }
    });

    //点击确认弹窗里的“确定”按钮
    for (let i = 0; i < 20; i++) {
        await sleep(500);
        const clicked = await frame.evaluate(() => {
            const candidates = [...document.querySelectorAll('a,button')].filter(el => {
                const text = (el.innerText || '').trim();
                const style = getComputedStyle(el);
                return text === '确定' && style.display !== 'none' && style.visibility !== 'hidden';
            });
            const target = candidates.find(el => /bluebtn/.test(el.className)) || candidates[0];
            if (target) { target.click(); return true; }
            return false;
        });
        if (clicked) { break; }
    }

    const response = await responsePromise;
    if (!response) {
        console.log('  提交后没有捕获到响应，请检查页面');
        return false;
    }
    let data = null;
    try { data = await response.json(); } catch (e) {}
    if (data) {
        console.log('  提交结果: status=', data.status, 'msg=', data.msg || '', 'url=', data.url || '');
        if (data.status) { return true; }
        return false;
    }
    console.log('  提交响应不是 JSON:', (await response.text().catch(() => '')).slice(0, 200));
    return false;
}

//自动完成一个练习题知识点
async function solveExercise(page, meta, point, openKnowledgePoint){
    console.log(`\n[${point.name}]（练习题）`);
    if (!deepseekApiKey) {
        console.log('  未配置 DEEPSEEK_API_KEY，无法自动作答，跳过');
        return false;
    }
    const cards = await openKnowledgePoint(page, meta, point);
    if (!cards) {
        console.log('  练习题页面未加载');
        return false;
    }
    const work = await waitForWorkFrame(page, 30000);
    if (!work) {
        console.log('  未找到练习题 iframe');
        return false;
    }

    let raw = await extractWork(work);
    for (let i = 0; i < 6 && (!raw.base64 || !raw.questions.length); i++) {
        await sleep(2000);
        raw = await extractWork(work);
    }
    if (!raw.questions.length) {
        console.log('  没有解析到题目');
        return false;
    }
    console.log(`  共 ${raw.questions.length} 题，正在解码题目文字...`);

    const chars = [];
    for (const q of raw.questions) {
        chars.push(...q.title, ...q.options.map(o => o.text));
    }
    const mapping = await buildMapping(work, raw.base64, chars);
    const lowConfidence = Object.values(mapping).filter(v => v.score < 0.85).length;
    console.log(`  字体解码完成：${Object.keys(mapping).length} 个混淆字符${lowConfidence ? `，其中 ${lowConfidence} 个置信度较低` : ''}`);

    const questions = await decodeQuestions(work, raw, mapping);
    for (const q of questions) {
        console.log(`  #${q.index + 1} [${q.type}] ${q.title.slice(0, 60)}`);
    }

    const aiPayload = questions.map(q => {
        let options;
        if (q.type === 'multi' || q.type === 'single') {
            options = {};
            for (const o of q.options) { options[o.letter] = o.text; }
        } else if (q.type === 'judge') {
            options = { '对': q.options[0] ? q.options[0].text : '对', '错': q.options[1] ? q.options[1].text : '错' };
        }
        return { id: q.qid, type: q.type, question: q.title, options };
    });

    console.log('  正在请求 DeepSeek 生成答案...');
    const answers = await answerQuestions(aiPayload, 10);
    console.log(`  已获取 ${Object.keys(answers).length}/${questions.length} 道题的答案`);

    const applyResult = await applyAnswers(work, questions, answers);
    console.log(`  已填写 ${applyResult.applied} 题${applyResult.failed.length ? `，失败 ${applyResult.failed.length} 题` : ''}`);
    if (applyResult.failed.length) {
        console.log('  失败详情:', JSON.stringify(applyResult.failed).slice(0, 500));
    }

    //检查未作答的题，尝试补答
    const filled = await work.evaluate((qs) => {
        const out = [];
        for (const q of qs) {
            if (q.type === 'fill') {
                const ed = window['answerEditor' + q.qid + '_1'];
                out.push({ qid: q.qid, value: ed ? ed.getContent() : '' });
            } else {
                const input = document.getElementById('answer' + q.qid);
                out.push({ qid: q.qid, value: input ? input.value : '' });
            }
        }
        return out;
    }, questions);
    const empty = filled.filter(x => !String(x.value || '').replace(/<[^>]+>/g, '').trim());
    if (empty.length) {
        console.log(`  仍有 ${empty.length} 题未填写: ${empty.map(x => x.qid).join(',')}`);
    }

    const ok = await submitWork(page, work);
    if (ok) {
        console.log('  练习题提交成功');
        await sleep(5000);
        return true;
    }
    console.log('  练习题提交失败');
    return false;
}

module.exports = { solveExercise, waitForWorkFrame };
