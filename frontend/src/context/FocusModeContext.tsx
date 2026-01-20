import { createContext, useContext, useMemo, useState } from "react";

type FocusModeContextValue = {
  focusAll: boolean;
  setFocusAll: (value: boolean) => void;
  toggleFocusAll: () => void;
};

const FocusModeContext = createContext<FocusModeContextValue | undefined>(undefined);

export const FocusModeProvider = ({ children }: { children: React.ReactNode }) => {
  const [focusAll, setFocusAll] = useState(false);
  const toggleFocusAll = () => setFocusAll((prev) => !prev);
  const value = useMemo(
    () => ({ focusAll, setFocusAll, toggleFocusAll }),
    [focusAll]
  );

  return <FocusModeContext.Provider value={value}>{children}</FocusModeContext.Provider>;
};

export const useFocusMode = () => {
  const context = useContext(FocusModeContext);
  if (!context) {
    throw new Error("useFocusMode must be used within FocusModeProvider");
  }
  return context;
};
