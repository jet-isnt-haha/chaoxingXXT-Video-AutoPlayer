const fs = require('fs');
const path = require('path');
require('dotenv').config({path:path.join(__dirname,'../.env')});//加载环境变量
//用户名
const USER =process.env.USER;
//密码
const PWD = process.env.PWD;
//加密数据源信息
const  ENC_SRC_DATA = {
    clazzId:undefined,
    userid:undefined,
    jobid:undefined,
    objectId:undefined,
    playingTime:undefined,
    salt:process.env.SALT,
    duration:undefined,
    clipTime:undefined
}
//用户代理环境
const USER_AGENT = process.env.USER_AGENT;
//脚本进入的初始地址
const BASE_URL = process.env.BASE_URL;


//课程ID（可通过查询字符串找到）
const COURSE_ID = process.env.COURSE_ID;

//班级ID（可通过查询字符串找到）
const CLASS_ID = process.env.CLASS_ID;

//播放视频后触发的网络请求前缀
const PREFIX_URL = process.env.PREFIX_URL;

// 从环境变量读取请求头配置
const REQUEST_HEADERS = {
    'Connection': process.env.HEADER_CONNECTION ,
    'Content-Type': process.env.HEADER_CONTENT_TYPE  ,
    'Accept': process.env.HEADER_ACCEPT, 
    'Host': process.env.HEADER_HOST ,
    'Accept-Encoding': process.env.HEADER_ACCEPT_ENCODING ,
    'Accept-Language': process.env.HEADER_ACCEPT_LANGUAGE ,
    'User-Agent': process.env.HEADER_USER_AGENT ,
    'Referer': process.env.HEADER_REFERER,
    'Sec-Ch-Ua': process.env.HEADER_SEC_CH_UA ,
    'Sec-Ch-Ua-Mobile': process.env.HEADER_SEC_CH_UA_MOBILE  ,
    'Sec-Ch-Ua-Platform': process.env.HEADER_SEC_CH_UA_PLATFORM ,
    'Sec-Fetch-Dest': process.env.HEADER_SEC_FETCH_DEST,
    'Sec-Fetch-Mode': process.env.HEADER_SEC_FETCH_MODE ,
    'Sec-Fetch-Site': process.env.HEADER_SEC_FETCH_SITE 
};

console.log(REQUEST_HEADERS);
//控制台输出置文本
const outputLog = function(){
    // 创建可写流
const logStream = fs.createWriteStream(path.join(__dirname, 'console_output.txt'), { flags: 'a' });
// 重定向控制台输出
const originalLog = console.log;
console.log = function(...args) {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
  ).join(' ');
  
  originalLog.apply(console, args); // 保持原有控制台输出
  logStream.write(message + '\n');  // 写入文件
};
}


module.exports={
    user:USER,
    pwd:PWD,
    encSrcData:ENC_SRC_DATA,
    userAgent:USER_AGENT,
    baseURL:BASE_URL,
    courseId:COURSE_ID,
    classId:CLASS_ID,
    prefixURL:PREFIX_URL,
    requestHeaders: REQUEST_HEADERS,
    outputLog
}