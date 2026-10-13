import "./globals.css";

export const metadata = {
  title: "Phrase Compass",
  description: "英语短语近期新闻使用证据与真实用例查询"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
