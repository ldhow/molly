import type { ExpoConfig } from "expo/config";

type Variant = "development" | "preview" | "production";

const VARIANT = (process.env.APP_VARIANT as Variant | undefined) ?? "development";

const BASE_BUNDLE_ID = "com.grtechdeveloper.molly";

const VARIANTS: Record<
  Variant,
  {
    name: string;
    bundleId: string;
    scheme: string;
    icon: string;
    adaptiveIconBackgroundColor: string;
    adaptiveIconBackgroundImage: string;
  }
> = {
  development: {
    name: "Molly (Dev)",
    bundleId: `${BASE_BUNDLE_ID}.dev`,
    scheme: "molly-dev",
    icon: "./assets/images/icon-dev.png",
    adaptiveIconBackgroundColor: "#FDECC8",
    adaptiveIconBackgroundImage: "./assets/images/android-icon-background-dev.png",
  },
  preview: {
    name: "Molly (Preview)",
    bundleId: `${BASE_BUNDLE_ID}.preview`,
    scheme: "molly-preview",
    icon: "./assets/images/icon-preview.png",
    adaptiveIconBackgroundColor: "#EDE4FB",
    adaptiveIconBackgroundImage: "./assets/images/android-icon-background-preview.png",
  },
  production: {
    name: "Molly",
    bundleId: BASE_BUNDLE_ID,
    scheme: "molly",
    icon: "./assets/images/icon.png",
    adaptiveIconBackgroundColor: "#E6F4FE",
    adaptiveIconBackgroundImage: "./assets/images/android-icon-background.png",
  },
};

const variant = VARIANTS[VARIANT];

export default (): ExpoConfig => ({
  name: variant.name,
  slug: "molly",
  version: "1.0.0",
  orientation: "default",
  icon: variant.icon,
  scheme: variant.scheme,
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: variant.bundleId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: variant.adaptiveIconBackgroundColor,
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: variant.adaptiveIconBackgroundImage,
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: variant.bundleId,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#208AEF",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    "expo-sqlite",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "59a9e055-6244-47cc-9ccd-bea653db67b8",
    },
    appVariant: VARIANT,
  },
  owner: "hippy-team",
  runtimeVersion: {
    policy: "appVersion",
  },
  updates: {
    url: "https://u.expo.dev/59a9e055-6244-47cc-9ccd-bea653db67b8",
  },
});
