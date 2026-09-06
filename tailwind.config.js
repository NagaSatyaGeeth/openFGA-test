module.exports = {
  content: ["./public/**/*.{html,js}"],
  safelist: [
    // level/badge classes are built dynamically in JS strings
    "bg-violet-100","text-violet-700","ring-violet-200",
    "bg-brand-100","text-brand-700","ring-brand-200",
    "bg-sky-100","text-sky-700","ring-sky-200",
    "bg-slate-100","text-slate-500","ring-slate-200",
    "border-emerald-200","bg-emerald-50","text-emerald-700",
    "border-rose-200","bg-rose-50","text-rose-700",
    "bg-brand-50","font-semibold",
  ],
  theme: { extend: { colors: { brand: { 50:'#eef2ff',100:'#e0e7ff',200:'#c7d2fe',400:'#818cf8',500:'#6366f1',600:'#4f46e5',700:'#4338ca' } } } },
};
