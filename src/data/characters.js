// Placeholder catalog. Swap fetchCharacters() in ../api/marketApi.js for a
// real call to your bot's database once that endpoint exists - every card
// only needs these same fields to keep working. "seller" stands in for
// whichever player listed the card - once this is wired to the bot, every
// entry here comes from a real listing instead of being hardcoded.
export const CHARACTERS = [
  {
    id: 1,
    name: "Yuki Frostpetal",
    series: "Starlit Requiem",
    rarity: "Legendary",
    price: 480,
    seller: "@moonlit_kai",
    gradient: ["#3A2E63", "#7B4FA6"],
  },
  {
    id: 2,
    name: "Rin Emberlynn",
    series: "Crimson Aegis",
    rarity: "Sovereign",
    price: 620,
    seller: "@emberforge",
    gradient: ["#4A1F3D", "#B9457A"],
  },
  {
    id: 3,
    name: "Sora Nightshade",
    series: "Halcyon Drift",
    rarity: "Nocturne",
    price: 210,
    seller: "@duskwalker7",
    gradient: ["#173A4E", "#2C8CA6"],
  },
  {
    id: 4,
    name: "Mika Thundervale",
    series: "Iron Bloom Academy",
    rarity: "Common",
    price: 40,
    seller: "@fielddeck",
    gradient: ["#2B2E1F", "#6B7A4A"],
  },
  {
    id: 5,
    name: "Aoi Sakuraba",
    series: "Starlit Requiem",
    rarity: "Omnara",
    price: 1450,
    seller: "@sakuraba_og",
    gradient: ["#4A1620", "#D9536A"],
  },
  {
    id: 6,
    name: "Kaito Ashborn",
    series: "Crimson Aegis",
    rarity: "Rare",
    price: 150,
    seller: "@ashcollector",
    gradient: ["#1E2A4A", "#4C6FB0"],
  },
  {
    id: 7,
    name: "Hana Silverwind",
    series: "Halcyon Drift",
    rarity: "Prismatic",
    price: 990,
    seller: "@windveil",
    gradient: ["#2E1F4A", "#8B5FC9"],
  },
  {
    id: 8,
    name: "Ren Kurogami",
    series: "Iron Bloom Academy",
    rarity: "Mystic",
    price: 340,
    seller: "@kurogami.tr",
    gradient: ["#241E33", "#5C5378"],
  },
];
