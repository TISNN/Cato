# Design System

## Visual Theme

TraeWork Light 是本项目的规范来源。默认使用明亮、低饱和的工作环境主题：用户在日间或常规办公室光线下长期使用，界面应保持安静、清晰和低视觉疲劳。

## Color

使用 TraeWork 的 `colors_and_type.css` token：`--bg-base-default`、`--bg-base-secondary`、`--text-default`、`--text-secondary`、`--text-tertiary`、`--border-neutral-l1`、`--bg-brand` 与状态 token。采用 Restrained 策略，品牌紫只用于主操作、当前选择和必要焦点，不用于装饰。

## Typography

沿用 TraeWork 的 SF Pro Text / PingFang SC 系统字体栈。正文使用 14px / 20px，移动端提升至 16px；页面标题使用 28px / 36px，模块标题使用 16px / 24px。数据使用 tabular numbers。

## Layout

桌面端采用 248px 可折叠侧边导航、固定顶栏和流式主工作区。页面以列表、分隔线和留白分组，只有独立任务对象可使用轻边框容器。禁止嵌套卡片。

## Components

优先采用 TraeWork 的按钮、输入、标签、表格、Tabs、菜单和进度组件的尺寸、圆角与状态语义。交互反馈只使用颜色、边框和 160 至 220ms 的透明度或背景过渡，不使用位移和装饰性动画。

## Responsive

1024px 以下收窄侧栏，768px 以下转为顶部导航和单列内容；移动端保留“下一步”和主要操作，次要元数据折叠到详情中。
