export type BrowserId = "chrome" | "edge";

export type BrowserProfileMode = "workstation" | "shared";

export type BrowserTool = {
  id: string;
  name: string;
  url: string;
};

export type BrowserToolInput = Pick<BrowserTool, "name" | "url">;

export type WorkstationBrowserState = {
  profileMode: BrowserProfileMode;
  profileId: string;
  tools: BrowserTool[];
  openOnWorkstationLaunch: boolean;
};
