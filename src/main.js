// 改前：点击后立刻检查一个已经不存在的元素
await page.waitForNavigation({ waitUntil: 'networkidle2' });
const isLoggedIn = await page.evaluate(() => {
    return document.querySelector('a[href="/logout/"]') !== null;
});

// 改后：先容忍导航异常，回到面板首页，再轮询最多 25 秒等 Dashboard 渲染
await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
await page.goto(`https://${panel}/`, { waitUntil: 'networkidle2' }).catch(() => {});
const isLoggedIn = await (async () => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        if (page.url().includes('/login')) return false;
        const ok = await page.evaluate((uname) => {
            const txt = document.body.innerText || '';
            if (document.querySelector('a[href="/logout/"]') || document.querySelector('a[href*="logout"]')) return true;
            return txt.includes(uname) && /Dashboard|Pulpit|DevilWEB/.test(txt);
        }, username).catch(() => false);
        if (ok) return true;
        await delayTime(1000);
    }
    return false;
})();
