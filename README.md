# XXT-Video-AutoPlayer

## 简介
`XXT-Video-AutoPlayer` 是一个基于 Node.js 的自动化脚本，利用 Puppeteer 库实现超新星平台课程视频的自动播放和学习进度完成功能。脚本通过模拟用户登录、进入课程、点击播放按钮、获取网络请求等操作，自动处理视频播放和学习进度更新，节省用户手动操作的时间和精力。

## 功能特性
1. **自动登录**：根据配置文件中的用户名和密码，自动登录超新星平台。
2. **课程导航**：自动进入指定课程和班级，遍历课程章节和小节。
3. **视频播放**：定位并点击视频播放按钮，获取播放相关的网络请求。
4. **学习进度更新**：检查视频是否已学习完成，若未完成则尝试解密并更新学习进度。
5. **日志记录**：将控制台输出记录到文件中，方便后续查看和调试。

## 安装步骤
1. **克隆仓库**
    ```bash
    git clone https://github.com/your-repo/XXT-Video-AutoPlayer.git
    cd XXT-Video-AutoPlayer
    ```
2. **安装依赖**
    ```bash
    pnpm install
    ```

## 配置文件
在项目根目录下创建 `.env` 文件，配置以下信息：
```plaintext
# 用户账号配置
USER=your_username
PWD=your_password

# 课程配置（可通过查询字符串找到）
COURSE_ID=your_course_id
CLASS_ID=your_class_id

#md5算法盐值
SALT=d_yHJ!$pdA~5

#用户代理环境
USER_AGENT = Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0
#脚本进入的初始地址
BASE_URL = https://i.chaoxing.com/

#播放视频后触发的网络请求前缀
PREFIX_URL = https://mooc1-2.chaoxing.com/mooc-ans/multimedia/log/a

# 请求头配置（可选修改）
HEADER_CONNECTION=keep-alive
HEADER_CONTENT_TYPE=application/json
HEADER_ACCEPT=*/*
HEADER_HOST=mooc1-2.chaoxing.com
HEADER_ACCEPT_ENCODING=gzip, deflate, br, zstd
HEADER_ACCEPT_LANGUAGE=en-CN,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,en-GB;q=0.6,en-US;q=0.5
HEADER_USER_AGENT=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36
HEADER_REFERER=https://mooc1-2.chaoxing.com/ananas/modules/video/index.html
HEADER_SEC_CH_UA="Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"
HEADER_SEC_CH_UA_MOBILE=?0
HEADER_SEC_CH_UA_PLATFORM=Windows
HEADER_SEC_FETCH_DEST=empty
HEADER_SEC_FETCH_MODE=cors
HEADER_SEC_FETCH_SITE=same-origin' 
```

## 使用方法
1. 确保 `.env` 文件已正确配置。
2. 运行脚本
    ```bash
    node xxt-script.js
    ```
3. 脚本运行过程中，控制台输出将同时记录到 `console_output.txt` 文件中。

## 注意事项
- 请确保你的 Node.js 版本符合项目依赖的要求。
- 脚本运行过程中可能会受到网络环境、页面结构变化等因素的影响，请根据实际情况进行调整。
- 使用本脚本应遵守超新星平台的使用条款和相关法律法规，请勿用于非法或违规目的。

## 贡献
如果你有任何建议或发现了 bug，请提交 issue 或 pull request，我们将非常感谢你的贡献。

## 许可证
本项目采用 ISC 许可证，详情请参阅 `LICENSE` 文件。

> 本项目仅供学习交流使用
