# 经师 · 中级经济师练习

独立静态网页，托管于 GitHub Pages；Supabase 保存题目、练习进度和作答记录。此阶段只验证《经济基础知识》的 3 道样题。

## 首次设置

1. 在 Supabase **SQL Editor** 执行 `supabase/setup.sql`。
2. 将本机忽略文件 `supabase/seed.local.sql` 的内容粘贴到 SQL Editor 执行。它含样题，不会提交到公开 GitHub 仓库。
3. 在 Supabase **Authentication → Users** 创建自己的邮箱/密码账号。然后在 Auth 设置中关闭 **Allow new users to sign up**，避免其他人注册后读取题库。网页本身也不开放自助注册。
4. 本地运行：

   ```sh
   npm install
   npm run dev
   ```

项目只使用 `src/config.js` 中的公开 anon key；它可以出现在浏览器。绝不能放入 `sb_secret_...` 或 service-role key。数据安全依赖 `setup.sql` 中的 RLS 策略。

## GitHub Pages

仓库根目录就是本目录。推送到 `main` 后，`.github/workflows/pages.yml` 自动构建和发布。首次部署前，在 GitHub 仓库 **Settings → Pages → Build and deployment** 选择 **GitHub Actions**。

当前站点地址：<https://gintama033.github.io/jingjishi-quiz-web/>。
