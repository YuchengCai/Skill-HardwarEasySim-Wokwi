# Monaco 浏览器操作步骤（Playwright MCP 主路径）

这是 **Mode A 自动化仿真的主路径**（Playwright MCP 方式）——适用于所有支持 MCP 的 agent（WorkBuddy、Kimi、Cline 等）。

> 定位：MCP 是首选（无需 node/npm 依赖）；`wokwi-automate.js` 脚本是**备用**（仅当能执行命令且无 MCP 时）。脚本失败也参考本手册用 MCP 操作完成。

---

## 前置：Playwright MCP 可用

```bash
# 确认 Playwright MCP 已配置（workbuddy: ~/.workbuddy/mcp.json）
npx --yes @playwright/mcp@latest --version
```

agent 通过以下 MCP 工具驱动浏览器：`browser_navigate` / `browser_evaluate` / `browser_click` / `browser_snapshot` / `browser_wait_for`。

---

## 步骤 1：打开 Wokwi 新项目页

```
工具: browser_navigate
参数: url = "https://wokwi.com/projects/new/arduino-uno"
验证: 页面标题 "New Arduino Uno Project - Wokwi Simulator"
```

---

## 步骤 2：等待 Monaco 就绪

```
工具: browser_evaluate
代码: 轮询等待 monaco.editor.getEditors().length > 0，超时 15s
```

```js
const waitMonaco = () => new Promise((resolve, reject) => {
  const start = Date.now();
  const t = setInterval(() => {
    if (typeof monaco !== 'undefined' && monaco.editor && monaco.editor.getEditors().length > 0) {
      clearInterval(t); resolve(true);
    } else if (Date.now() - start > 15000) {
      clearInterval(t); reject(new Error('monaco not ready'));
    }
  }, 200);
});
await waitMonaco();
```

---

## 步骤 3：填入 sketch.ino

⚠️ **切勿用 browser_type / fill** —— 会触发 Monaco 逐行自动缩进叠加，导致缩进错乱。

```
工具: browser_evaluate
代码: editors[0].setValue(<ino 代码全文>)
```

```js
const editors = monaco.editor.getEditors();
editors[0].setValue(`/* Arduino 代码全文 */`);
```

---

## 步骤 4：切换到 diagram.json 并填入

### 4a. 点击 diagram.json 标签

```
工具: browser_evaluate
```

```js
const btn = Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.trim() === 'diagram.json');
btn.click();
```

### 4b. 轮询等待可见的 json 编辑器（标签切换是异步的）

```js
const jsonReady = () => new Promise((resolve) => {
  const start = Date.now();
  const t = setInterval(() => {
    const editors = monaco.editor.getEditors();
    for (const ed of editors) {
      // 判定可见: 沿 DOM 向上找 display:none 祖先
      const dom = ed.getDomNode();
      let el = dom, visible = true;
      while (el && el !== document.body) {
        if (getComputedStyle(el).display === 'none') { visible = false; break; }
        el = el.parentElement;
      }
      // 语言判定: json
      if (visible && ed.getModel() && ed.getModel().getLanguageId() === 'json') {
        clearInterval(t); resolve(ed); return;
      }
    }
    if (Date.now() - start > 15000) { clearInterval(t); resolve(null); }
  }, 200);
});
```

### 4c. 填入电路图

```js
visibleEditor.setValue(JSON.stringify(diagramJson, null, 2));
```

---

## 步骤 5：交给用户启动仿真（不自动点击）

⚠️ **不自动点击 Start the simulation**：MCP 打开的浏览器实例**未登录 Wokwi**，没有服务器资源分配，自动点击后模拟极慢甚至不跑。

填入代码 + 电路图后，agent 应：

1. 告知用户：「项目代码和电路图已填入浏览器，请**自己点击网页上的 Start the simulation 按钮**查看结果」
2. 建议用户**登录 Wokwi**（登录后获得服务器资源，模拟快且稳定）
3. **不要截图验证**——把浏览器窗口交给用户观察 LED 行为

---

## 失败排查对照

| 现象 | 可能原因 | 排查 |
|------|---------|------|
| monaco not ready | 页面未完全加载 | 等待更久 / 检查网络 |
| diagram.json 按钮找不到 | 页面结构变化 | 用 snapshot 检查按钮文本 |
| json editor 不可见 | 切标签异步未完成 | 加长轮询时间 |
| setValue 无效果 | 编辑器未挂载 | 确认是可见编辑器 |
| Start 按钮找不到 | 大小写/文本变化 | snapshot 获取精确可访问名称 |
| 点击后无反应 | 页面刷新导致 ref 失效 | 重新 snapshot 再点击 |

---

## 注意事项

1. **每次导航/刷新后元素 ref 失效** —— 每次操作前重新 `browser_snapshot`
2. **按钮文本区分大小写** —— "Start the simulation" 精确匹配
3. **无需登录** —— URL 直达 `/projects/new/arduino-uno` 即可
4. **不截图验证结果** —— 浏览器有头模式用户可见，直接观察
