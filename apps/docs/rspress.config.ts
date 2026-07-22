import { defineConfig } from 'rspress/config';

export default defineConfig({
  root: __dirname,
  title: 'Phus',
  description: '西西弗斯 - 自进化的 AI Agent 运行时',
  themeConfig: {
    nav: [
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '指南', link: '/guide/' },
      { text: '命令参考', link: '/commands/' },
      { text: '插件开发', link: '/plugins/' },
      { text: '开发进度', link: '/changelog' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '介绍', link: '/guide/' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '架构设计', link: '/guide/architecture' },
            { text: '部署方式', link: '/guide/deploy' },
            { text: '发布体系', link: '/guide/release' },
            { text: 'TUI 快捷键', link: '/guide/tui-shortcuts' },
          ],
        },
      ],
      '/commands/': [
        {
          text: '命令参考',
          items: [
            { text: '概览', link: '/commands/' },
            { text: 'setup', link: '/commands/setup' },
            { text: 'gateway', link: '/commands/gateway' },
            { text: 'run', link: '/commands/run' },
            { text: 'chat', link: '/commands/chat' },
            { text: 'tasks', link: '/commands/tasks' },
            { text: 'skills', link: '/commands/skills' },
            { text: 'health', link: '/commands/health' },
            { text: '其他命令', link: '/commands/others' },
          ],
        },
      ],
      '/plugins/': [
        {
          text: '插件开发',
          items: [
            { text: '入门', link: '/plugins/' },
          ],
        },
      ],
    },
  },
});
