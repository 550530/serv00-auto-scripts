import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import axios from 'axios';
import { fileURLToPath } from 'url';

function formatToISO(date) {
    return date.toISOString().replace('T', ' ').replace('Z', '').replace(/\.\d{3}Z/, '');
}

async function delayTime(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramMessage(token, chatId, message) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const data = { chat_id: chatId, text: message };
    try {
        await axios.post(url, data);
        console.log('消息已发送到 Telegram');
    } catch (error) {
        console.error('发送 Telegram 消息时出错:', error.message);
    }
}

(async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const accounts = JSON.parse(fs.readFileSync(path.join(__dirname, '../accounts.json'), 'utf-8'));
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    const panelBaseUrl = "panel";
    const defaultDomain = "serv00.com";

    const loginResults = [];

    for (const account of accounts) {
        const { username, password, panelnum, domain } = account;

        let panel;
        if (domain === "ct8.pl") {
            panel = `panel.${domain}`;
        } else {
            panel = `${panelBaseUrl}${panelnum}.${domain || defaultDomain}`;
        }

        const url = `https://${panel}/login/?next=/`;
        console.log(`尝试登录账号 ${username}，地址: ${url}`);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        });
        const page = await browser.newPage();

        try {
            await page.goto(url, { waitUntil: 'networkidle2' });

            const usernameInput = await page.$('#id_username');
            if (usernameInput) {
                await usernameInput.click({ clickCount: 3 });
                await usernameInput.press('Backspace');
            }
            await page.type('#id_username', username);
            await page.type('#id_password', password);

            // 使用更新后的按钮选择器
            const loginButton = await page.$('.login-form__button .button--primary');
            if (loginButton) {
                await loginButton.click();
            } else {
                throw new Error('无法找到登录按钮');
            }

            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});

            // 新版 DevilWEB 面板登录后会先 302 到过渡页 /next/，Dashboard 由前端延迟渲染，
            // 且页面上已不存在 a[href="/logout/"]，因此改为回到面板首页后轮询等待 Dashboard 出现
            await page.goto(`https://${panel}/`, { waitUntil: 'networkidle2' }).catch(() => {});
            const isLoggedIn = await (async () => {
                const deadline = Date.now() + 25000;
                while (Date.now() < deadline) {
                    if (page.url().includes('/login')) {
                        return false;
                    }
                    const ok = await page.evaluate((uname) => {
                        const txt = document.body.innerText || '';
                        if (document.querySelector('a[href="/logout/"]') || document.querySelector('a[href*="logout"]')) {
                            return true;
                        }
                        return txt.includes(uname) && /Dashboard|Pulpit|DevilWEB/.test(txt);
                    }, username).catch(() => false);
                    if (ok) {
                        return true;
                    }
                    await delayTime(1000);
                }
                return false;
            })();

            const nowUtc = formatToISO(new Date());
            const nowBeijing = formatToISO(new Date(new Date().getTime() + 8 * 60 * 60 * 1000));

            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            const status = isLoggedIn ? "登录成功" : "登录失败";

            loginResults.push(`账号（${username}）（${serverName}）${status}`);
            console.log(`账号 ${username} 于北京时间 ${nowBeijing}（UTC时间 ${nowUtc}）${status}`);
        } catch (error) {
            const serverName = domain === "ct8.pl" ? "ct8" : `serv00-${panelnum}`;
            loginResults.push(`账号（${username}）（${serverName}）登录时出现错误: ${error.message}`);
            console.error(`账号 ${username} 登录时出现错误: ${error.message}`);
        } finally {
            await page.close();
            await browser.close();
            const delay = Math.floor(Math.random() * 5000) + 1000;
            await delayTime(delay);
        }
    }

    // 汇总并发送报告
    const nowBeijing = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
    const year = nowBeijing.getFullYear();
    const month = String(nowBeijing.getMonth() + 1).padStart(2, '0');
    const day = String(nowBeijing.getDate()).padStart(2, '0');
    const hours = String(nowBeijing.getHours()).padStart(2, '0');
    const minutes = String(nowBeijing.getMinutes()).padStart(2, '0');
    const seconds = String(nowBeijing.getSeconds()).padStart(2, '0');

    const chineseTime = `${year}年${month}月${day}日 ${hours}时${minutes}分${seconds}秒`;
    const reportTitle = `ct8&serv00 登陆报告（北京时间：${chineseTime}）：`;

    let successCount = 0;
    let failureCount = 0;
    const failedAccounts = [];

    for (const result of loginResults) {
        if (result.includes('登录成功')) {
            successCount++;
        } else {
            failureCount++;
            const match = result.match(/账号（(.+?)）/);
            if (match && match[1]) {
                failedAccounts.push(match[1]);
            }
        }
    }

    const summary = `✅ 成功：${successCount} 个\n❌ 失败：${failureCount} 个`;

    let failedList = '';
    if (failedAccounts.length > 0) {
        failedList = '\n\n🔻 登录失败账号列表：\n' + failedAccounts.map((u, i) => `${i + 1}. ${u}`).join('\n');
    }

    const reportContent = loginResults.join('\n');
    const finalReport = `${reportTitle}\n${summary}\n\n${reportContent}${failedList}`;

    console.log(finalReport);

    if (telegramToken && telegramChatId) {
        await sendTelegramMessage(telegramToken, telegramChatId, finalReport);
    }

    console.log('所有账号登录完成！');
})();
