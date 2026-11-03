import { currentSkin } from "../skin"

export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

// A getter, so every `customBorderChars={SplitBorder.customBorderChars}` and `{...SplitBorder}`
// call site follows the active skin without threading it through props.
export const SplitBorder = {
  border: ["left" as const, "right" as const],
  get customBorderChars() {
    return {
      ...EmptyBorder,
      vertical: currentSkin().border.vertical,
    }
  },
}
