<p align="center">
  <img src="public/banner.png" alt="立方" width="520" />
</p>

<p align="center">
  智能魔方的在线练习与成绩分析工具
</p>

<p align="center">
  <a href="https://cube.mwhitelab.com">在线体验</a>
  ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-v0.1.1-4b7bec" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6" />
  <img alt="GAN Smart Cube" src="https://img.shields.io/badge/GAN-Smart_Cube-55a86b" />
</p>

![练习界面](practive.jpg)

## 功能

- 通过 Web Bluetooth 连接 GAN 智能魔方
- 三维魔方同步、计时练习与专项训练
- CFOP 公式浏览、筛选与练习
- 成绩趋势、阶段用时与练习热力图
- 中英文界面与本地数据存档

> [!NOTE]
> 当前仅支持 GAN 智能魔方，建议使用支持 Web Bluetooth 的 Chromium 浏览器访问。

## 本地运行

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 技术栈

Next.js · React · TypeScript · Three.js · GAN Web Bluetooth

## 致谢

感谢 [afedotov/gan-web-bluetooth](https://github.com/afedotov/gan-web-bluetooth) 提供 GAN 智能魔方的 Web Bluetooth 支持。
