import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Buyzi",
    short_name: "Buyzi",
    description: "New Zealand's trusted marketplace",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF8",
    theme_color: "#141414",
    icons: [{ src: "/icon", sizes: "32x32", type: "image/png" }],
  };
}
