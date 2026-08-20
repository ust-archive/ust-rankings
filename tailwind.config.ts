import forms from "@tailwindcss/forms";

export default {
  theme: {
    extend: {
      keyframes: {
        slideDown: {
          from: { height: "0" },
          to: { height: "var(--radix-collapsible-content-height)" },
        },
        slideUp: {
          from: { height: "var(--radix-collapsible-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        slideDown: "slideDown 300ms ease-out",
        slideUp: "slideUp 0.2s ease-out",
      },
      fontFamily: {
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [forms],
};
