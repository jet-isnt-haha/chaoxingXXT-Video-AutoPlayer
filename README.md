# XXT-Video-AutoPlayer

基于 Node.js + Puppeteer 的超星学习通（chaoxing.com）课程自动化脚本。已适配 2025/2026 新版 `mooc2-ans` 课程页面：自动登录、进入指定课程、按顺序完成视频和练习题，并自动提交。

> 本项目仅供学习交流使用，请遵守平台服务条款和当地法律法规。

## 功能特性

1. **自动登录**：使用 `.env` 中的账号密码登录超星。
2. **自动进入课程**：根据 `COURSE_ID` / `CLASS_ID` 在“我学的课”中定位课程，并打开新版“章节”页。
3. **按顺序解锁**：新版课程按顺序开放知识点，脚本只处理当前已解锁的节点，完成后刷新章节页继续下一个。
4. **并行播放**：同一知识点下的多个视频会同时播放，知识点耗时约等于最长的那一个视频，而不是逐个累加。
5. **断点续播**：通过任务点的 `playTime` 跳过已学完的视频，未学完的从上次进度继续。
6. **自动完成练习题**：接入 DeepSeek 大模型，自动识别单选、多选、判断、填空题并作答、提交。
7. **题目字体解密**：超星练习题使用 `font-cxsecret` 混淆字体，脚本内置字形匹配，把乱码还原成真实题目文字后再交给大模型。
8. **日志记录**：控制台输出同时写入 `src/console_output.txt`。

## 环境要求

- Node.js 18 及以上（推荐 20+）
- 本机已安装 Chrome 或 Edge

脚本会优先使用本机浏览器；如果找不到，再使用 Puppeteer 自带的 Chrome。也可以手动安装 Puppeteer 浏览器：

```bash
npx puppeteer browsers install chrome
```

## 安装

```bash
pnpm install
```

（使用 npm 也可以：`npm install`）

## 配置

在项目根目录创建 `.env`（可从 `.env.example` 复制），至少填写：

```plaintext
# 账号
USER=你的手机号
PWD=你的密码

# 课程配置
COURSE_ID=课程ID
CLASS_ID=班级ID

# 用户代理
USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36

# 登录入口
BASE_URL=https://i.chaoxing.com/

# md5 盐值（秒过时使用）
SALT=d_yHJ!$pdA~5

# DeepSeek 大模型（自动完成练习题）
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

`COURSE_ID` 和 `CLASS_ID` 的获取方式：

1. 登录后打开 <https://mooc1.chaoxing.com/visit/interaction>；
2. 点击目标课程进入课程页；
3. 地址栏中 `courseid=` 后面是 `COURSE_ID`，`clazzid=` 后面是 `CLASS_ID`。

> `PREFIX_URL` 及 `HEADER_*` 仍然保留在 `.env.example` 中用于兼容旧配置，但新版脚本不再依赖它们（上报接口按路径 `/multimedia/log/a/` 自动识别，请求头由浏览器自动携带）。

## 运行

在**项目根目录**执行：

```bash
pnpm start
# 或者
node src/xxt-script.js
```

运行时不要关闭终端；脚本会依次处理所有章节，视频较多时需要较长时间。

## 工作原理

1. 登录后进入 `https://mooc1.chaoxing.com/visit/interaction`，按 `COURSE_ID` + `CLASS_ID` 找到课程；
2. 打开课程页的“章节”标签，找出当前**已解锁**（带 `onclick`）的知识点；
3. 打开该知识点的 `studentstudy` 页面，在 `#iframe` 中查找视频 iframe（`iframe.ans-insertvideo-online`）；
4. 点击播放，从浏览器的 `/multimedia/log/a/` 上报请求中取得 `duration`、`jobid`、`objectId` 等信息；
5. 先尝试一次性上报完成（`isdrag=4`）；如果课程开启了防拖拽会返回 `isPassed:false`，此时脚本会继续正常播放，直到视频结束；
6. 同一知识点下的多个视频会并行播放，播放结束后按 `jobid` 分别补发完成上报；
7. 遇到练习题时，进入 `doHomeWorkNew` 页面，提取题目与 `font-cxsecret` 字体，使用内置字形库还原乱码文字；
8. 把还原后的题目批量发送给 DeepSeek，按单选/多选/判断/填空自动作答，然后走页面的正常流程提交；
9. 刷新章节页继续下一个已解锁知识点。

## 注意事项

- **防拖拽课程只能按真实时长播放**：超星开启了“不可拖拽/不可倍速”的课程无法秒过，脚本会按视频实际时长播放。课程视频总时长决定了运行时间。
- **按顺序学习**：新版课程通常是“完成当前知识点后才解锁下一个”，脚本每完成一个知识点会重新打开章节页获取下一个节点。
- **练习题由大模型作答**：答案由 DeepSeek 生成，脚本不保证 100% 正确；提交后可在课程页面查看得分。如果不及格需要重做，请重新运行脚本。
- 练习题提交依赖页面自身的 `btnBlueSubmit → 确认 → confirmSubmitWork` 流程；如果平台弹出验证码，脚本无法自动处理。
- 如果待完成任务是文档、音频等非视频/非练习题类型，脚本会提示并停止。
- 新版页面中同一知识点可能包含多个视频，脚本会**同时播放**这些视频，耗时约等于最长视频的时长；已学完的视频会跳过。
- 脚本会定时把页面置于前台并移动鼠标，避免播放器因“离开页面/长时间无操作”而暂停。
- 如果平台提示“本次学习时长已达上限”，请隔一段时间再运行，或分章节运行。
- 播放依赖浏览器中的 video.js 播放器，请保持网络畅通；页面结构若再次大改，脚本的选择器可能还需要调整。
- 脚本使用无头浏览器（headless），弹出窗口、验证码等情况无法自动处理；遇到登录验证请在配置中换用可正常登录的网络环境。

## 常见问题

**启动时报 `Could not find Chrome`**

说明既没有安装本机 Chrome/Edge，也没有下载 Puppeteer 自带浏览器。安装 Chrome，或执行：

```bash
npx puppeteer browsers install chrome
```

**提示“课程列表中没有找到 courseId=... 的课程”**

`COURSE_ID` / `CLASS_ID` 填错，或当前账号没有加入该课程。按上面的方式重新从课程页地址栏复制。

**提示“未能从章节页面解析出 enc / cpi”**

超星页面结构发生变化，需要更新 `src/xxt-script.js` 中 `enterChapterTab()` 的解析逻辑。

**控制台一直显示“秒过失败”**

该课程开启了防拖拽，这是正常现象，脚本会继续按真实时长播放。

**练习题提交返回“无效的参数：code-1 / code-2”**

通常是页面提交流程被绕过导致的。脚本现在使用页面原生的 `btnBlueSubmit()` 和确认弹窗提交；如果仍出现，请检查 `src/exercise.js` 中 `submitWork()` 是否与当前页面结构一致。

**练习题答案明显不对**

可以在 `src/deepseek.js` 中调整提示词或换用更强的模型（修改 `.env` 的 `DEEPSEEK_MODEL`）。

## 目录结构

```plaintext
.
├── .env.example              # 配置示例
├── package.json
├── pnpm-lock.yaml
├── README.md
└── src
    ├── config.js             # 读取 .env、日志输出
    ├── xxt-script.js         # 主脚本（登录、章节、视频）
    ├── exercise.js           # 练习题解析、作答、提交
    ├── deepseek.js           # DeepSeek API 调用
    ├── fontDecoder.js        # font-cxsecret 字体解密
    ├── chaoxing-font-db.bin.gz  # 参考字形库（Source Han Sans）
    └── chaoxing-font-chars.txt  # 字形库对应字符表
```

## 许可证

MIT，详情见 `LICENSE`。
