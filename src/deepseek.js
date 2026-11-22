const { deepseekApiKey, deepseekModel, deepseekBaseUrl } = require('./config');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseJson(text){
    if (!text) { return null; }
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) { s = s.slice(start, end + 1); }
    try { return JSON.parse(s); } catch (e) { return null; }
}

async function chat(messages, retries = 3){
    if (!deepseekApiKey) {
        throw new Error('未配置 DEEPSEEK_API_KEY，请在 .env 中填写');
    }
    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(`${deepseekBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${deepseekApiKey}`,
                },
                body: JSON.stringify({
                    model: deepseekModel,
                    messages,
                    temperature: 0,
                    response_format: { type: 'json_object' },
                }),
            });
            if (!res.ok) {
                lastError = new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
                throw lastError;
            }
            const data = await res.json();
            const content = data.choices && data.choices[0] && data.choices[0].message
                ? data.choices[0].message.content
                : '';
            const parsed = parseJson(content);
            if (!parsed) {
                lastError = new Error('DeepSeek 返回内容不是合法 JSON');
                throw lastError;
            }
            return parsed;
        } catch (e) {
            lastError = e;
            if (i < retries - 1) { await sleep(1500 * (i + 1)); }
        }
    }
    throw lastError;
}

const TYPE_LABEL = {
    single: 'single（单选，答案是一个选项字母）',
    multi: 'multi（多选，答案是选项字母数组）',
    judge: 'judge（判断，答案是"对"或"错"）',
    fill: 'fill（填空，答案是简短文本）',
};

//向大模型批量询问答案，返回 {qid: answer}
async function answerQuestions(questions, batchSize = 10){
    const answers = {};
    const batches = [];
    for (let i = 0; i < questions.length; i += batchSize) {
        batches.push(questions.slice(i, i + batchSize));
    }

    const system = [
        '你是中国高校思政课程的答题助手，需要根据题目选出正确答案。',
        '只输出 JSON，不要输出解释或多余文字。',
        '输出格式：{"answers":{"题目id":"答案", ...}}',
        '题型说明：',
        'single：单选题，答案写一个选项字母，如 "C"',
        'multi：多选题，答案写选项字母数组，如 ["A","C"]',
        'judge：判断题，答案写 "对" 或 "错"',
        'fill：填空题，答案写填入空的简短文本',
    ].join('\n');

    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        console.log(`  正在请求大模型：第 ${b + 1}/${batches.length} 批（${batch.length} 题）`);
        const payload = batch.map(q => ({
            id: q.id,
            type: TYPE_LABEL[q.type] || q.type,
            question: q.question,
            options: q.options || undefined,
        }));
        const user = `题目列表：\n${JSON.stringify(payload, null, 2)}\n\n请返回 {"answers":{...}}。`;
        try {
            const data = await chat([
                { role: 'system', content: system },
                { role: 'user', content: user },
            ]);
            const part = data.answers || data;
            for (const [id, answer] of Object.entries(part)) {
                if (answer !== undefined && answer !== null && answer !== '') {
                    answers[id] = answer;
                }
            }
        } catch (e) {
            console.error(`  第 ${b + 1} 批请求失败:`, e.message);
        }
    }
    return answers;
}

module.exports = { answerQuestions, chat };
