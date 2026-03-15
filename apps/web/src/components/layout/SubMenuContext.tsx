import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export type SubMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
};

type SubMenuDropdown = {
  type?: "dropdown";
  items: SubMenuItem[];
  activeId: string;
  setActiveId: (id: string) => void;
};

type SubMenuAction = {
  type: "action";
  label: string;
  icon?: ReactNode;
  onClick: () => void;
};

type SubMenuState = SubMenuDropdown | SubMenuAction;

const SubMenuContext = createContext<SubMenuState | null>(null);

export function SubMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SubMenuState | null>(null);

  return (
    <SubMenuContext.Provider value={state}>
      <SubMenuSetterContext.Provider value={setState}>
        {children}
      </SubMenuSetterContext.Provider>
    </SubMenuContext.Provider>
  );
}

const SubMenuSetterContext = createContext<
  React.Dispatch<React.SetStateAction<SubMenuState | null>> | null
>(null);

export function useSubMenu() {
  return useContext(SubMenuContext);
}

export function useRegisterSubMenu(
  items: SubMenuItem[],
  activeId: string,
  setActiveId: (id: string) => void
) {
  const setSub = useContext(SubMenuSetterContext);

  useEffect(() => {
    if (!setSub) return;
    setSub({ items, activeId, setActiveId });
    return () => setSub(null);
  }, [setSub, items, activeId, setActiveId]);
}

export function useRegisterSubMenuAction(
  label: string,
  onClick: () => void,
  icon?: ReactNode
) {
  const setSub = useContext(SubMenuSetterContext);

  useEffect(() => {
    if (!setSub) return;
    setSub({ type: "action", label, icon, onClick });
    return () => setSub(null);
  }, [setSub, label, icon, onClick]);
}
