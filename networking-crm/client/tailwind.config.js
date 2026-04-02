/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0f0f0f",
        card: "#1a1a1a",
        "card-hover": "#222222",
        accent: "#6366f1",
        "accent-hover": "#818cf8",
        rec: "#ef4444",
        success: "#22c55e",
        danger: "#ef4444",
        "w-red": "#ef4444",
        "w-yellow": "#eab308",
        "w-green": "#22c55e",
        "w-orange": "#f97316",
        "w-gray": "#6b7280",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
