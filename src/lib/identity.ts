import type { Project, ProjectIcon } from "../ipc";

/** 24 hues, 15° apart (shown in hue order). */
export const PROJECT_COLORS = Array.from({ length: 24 }, (_, i) => `hsl(${i * 15} 72% 60%)`);

/** Material symbol names (checked against the installed material-symbols list). */
export const PROJECT_ICONS = (
  "data_object code terminal rocket_launch api cloud database dns web desktop_mac bolt science bug_report palette extension " +
  "hub memory layers deployed_code psychology school work home favorite flag shopping_cart sports_esports token storefront campaign " +
  "analytics monitoring query_stats pie_chart receipt_long payments account_balance wallet credit_card local_shipping flight map " +
  "travel_explore public language translate chat forum mail call videocam photo_camera image movie music_note headphones mic " +
  "podcasts menu_book article description edit_note draw brush construction handyman engineering precision_manufacturing smart_toy " +
  "robot_2 neurology biotech health_and_safety fitness_center restaurant coffee pets eco park sunny bedtime satellite_alt shield lock " +
  "key verified inventory_2 widgets grid_view dashboard schema account_tree lan router developer_board keyboard gamepad casino toys " +
  "celebration diamond military_tech lightbulb"
).split(" ");

export const PROJECT_EMOJIS = (
  "🚀 💻 🧠 ⚡ 🔥 🌟 🎯 🛠️ 🧪 🐛 🎨 📦 🧩 🔌 🌐 ☁️ 🗄️ 📱 🖥️ 🤖 🎮 🛒 💳 📊 📈 📝 📚 🎓 🏠 ❤️ " +
  "🌱 🌊 🌙 ☀️ 🍕 ☕ 🐳 🦀 🐍 🦊 🐙 🦄 🐝 🍀 🎵 🎬 📷 ✈️ 🚗 🏁 🔒 🔑 💎 👑 🎉 🧭 🛰️ 🧲 🪐"
).split(" ");

/** Exactly one user-perceived character (handles ZWJ sequences, flags, skin tones). */
export function isSingleEmoji(s: string) {
  const t = s.trim();
  if (!t) return false;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)];
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t);
}

// Auto-assignment walks the palette in 75° steps so consecutive projects look clearly different.
const COLOR_ORDER = Array.from({ length: 24 }, (_, i) => PROJECT_COLORS[(i * 5) % 24]);

/** First color and icon not used by any existing project (cycles once everything is taken). */
export function nextIdentity(projects: Project[]): { color: string; icon: ProjectIcon } {
  const colors = new Set(projects.map((p) => p.color));
  const icons = new Set(projects.flatMap((p) => (p.icon?.type === "symbol" ? [p.icon.value] : [])));
  const color = COLOR_ORDER.find((c) => !colors.has(c)) ?? COLOR_ORDER[projects.length % COLOR_ORDER.length];
  const name = PROJECT_ICONS.find((i) => !icons.has(i)) ?? PROJECT_ICONS[projects.length % PROJECT_ICONS.length];
  return { color, icon: { type: "symbol", value: name } };
}
