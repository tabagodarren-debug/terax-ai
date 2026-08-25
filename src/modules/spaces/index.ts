export type { SpaceMeta } from "./lib/store";
export { newSpaceId as newWorkstationId } from "./lib/store";
export { useSpacePersistence } from "./lib/useSpacePersistence";
export { useSpaces } from "./lib/useSpaces";
export {
  restoreSavedSpaceTabs,
  useSpacesBoot,
} from "./lib/useSpacesBoot";
export {
  authorizeWorkstationRoot,
  type ScaffoldReport,
  type ScaffoldRequest,
  scaffoldWorkstation,
} from "./lib/workstationNative";
export {
  findWorkstationByRoot,
  normalizeWorkstationRoot,
  workstationNameFromRoot,
} from "./lib/workstationPaths";
export { SpaceAvatar } from "./SpaceAvatar";
export { SpaceSwitcher } from "./SpaceSwitcher";
export type {
  WorkstationMoveDirection,
  WorkstationSidebarItem,
  WorkstationSidebarProps,
} from "./WorkstationSidebar";
export {
  moveWorkstationIds,
  normalizeWorkstationName,
  WorkstationSidebar,
  workstationRootLabel,
} from "./WorkstationSidebar";
