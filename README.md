# 美化图床本地化 (Theme Image Localizer)

SillyTavern（酒馆）扩展插件，用于一键将酒馆美化主题中的**网络外链图片/网络图床资源**无损下载转存到本地，并自动同步更新主题 CSS 引用路径，彻底解决图床失效（404/防盗链）和外网加载卡顿缓慢的问题。

---

## ✨ 核心特性

1. **一键智能扫描**：
   - 自动读取当前已保存的美化主题配置（`/api/settings/get`）。
   - 精准过滤与提取主题 CSS 中的网络图片链接（智能排除字体文件与在线样式链接）。
2. **多级安全下载与防 CORS 拦截**：
   - 支持前端直连抓取与酒馆后端同源流代理下载（`/api/search/visit`），轻松绕过 Cloudflare R2 等图床的跨域防盗链（`CORS / Failed to fetch`）拦截。
   - 图片按 SHA/Hash 重命名并存入本地用户目录：`/user/images/themes/`。
   - 自动查重机制，已存在的本地图片自动跳过，不重复消耗流量。
3. **全自动 CSS 路径同步替换**：
   - 自动将主题 CSS 中的外链 `url('https://...')` 替换为本地绝对路径 `url('/user/images/themes/xxx.png')`。
   - 自动写回磁盘上的主题文件（`data/default-user/themes/*.json`）。
   - 若正在使用当前主题，即时热刷新页面渲染样式，无需刷新酒馆。
4. **精美原生 UI 体验**：
   - 遵循酒馆原生弹窗架构（`callGenericPopup`），弹窗居中且相对于酒馆界面。
   - 完美适配日间（Light）与夜间（Dark）模式切换。
   - 严格横向排版，抵御第三方主题的非常规 CSS 干扰。

---

## 🚀 安装与使用

### 安装方式
在 SillyTavern 的 **扩展插件（Extensions）** 管理器中选择从 Git URL 安装：
```
https://github.com/cone97218-alt/theme
```
或直接将本项目克隆/解压至酒馆目录：
`public/scripts/extensions/third-party/theme-image-localizer`

### 使用方法
1. 打开酒馆网页，进入顶部 **拓展设置（Extensions Settings）** 面板。
2. 找到 **美化图床本地化** 抽屉，点击 **【打开本地化控制面板】**。
3. 点击 **【扫描外链】** 查看所有主题的外链引用情况。
4. 点击 **【转存当前主题】** 或 **【一键转存所有主题】** 即可全自动完成下载与路径同步替换。
