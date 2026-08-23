import "./globals.css";

export const metadata = {
  title: "Peanut Butter",
  description: "A playlist discovery and streaming site for music that's actually yours to use.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
