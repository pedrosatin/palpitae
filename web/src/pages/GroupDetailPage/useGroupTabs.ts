import { useSearchParams } from "react-router-dom";
import { trackEvent } from "../../analytics/ga";

export const TABS = [
  "predictions",
  "standings",
  "group-picks",
  "leaderboard",
  "members",
] as const;
export type Tab = (typeof TABS)[number];

export const DEFAULT_TAB: Tab = "predictions";

export const TAB_LABELS: Record<Tab, string> = {
  predictions: "Palpitar",
  standings: "Tabela",
  "group-picks": "Grupo",
  leaderboard: "Ranking",
  members: "Membros",
};

export function parseTab(value: string | null): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : DEFAULT_TAB;
}

export function useGroupTabs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));

  function setActiveTab(tab: Tab) {
    trackEvent("click_group_detail_tab", { tab });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === DEFAULT_TAB) {
          next.delete("tab");
        } else {
          next.set("tab", tab);
        }
        return next;
      },
      { replace: true },
    );
  }

  function tabHref(tab: Tab): string {
    const params = new URLSearchParams(searchParams);
    if (tab === DEFAULT_TAB) {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const qs = params.toString();
    return qs ? `?${qs}` : ".";
  }

  function handleTabClick(e: React.MouseEvent<HTMLAnchorElement>, tab: Tab) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      setActiveTab(tab);
    }
  }

  return { activeTab, setActiveTab, tabHref, handleTabClick };
}
