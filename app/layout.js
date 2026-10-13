import "./globals.css";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/newsreader";

export const metadata = {
  title: "Phrase Compass",
  description: "用近期美英新闻证据判断英语短语是否常用，并查看真实文章用例。"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
