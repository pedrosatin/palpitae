import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { config } from "../../config";
import { useConfirm } from "../../components/ConfirmModal";
import Button from "../../components/Button";
import CreateGroupModal from "../../components/CreateGroupModal";
import Header from "../../components/Header";
import JoinGroupModal from "../../components/JoinGroupModal";
import Modal from "../../components/Modal";
import GroupPicksTab from "../../components/GroupPicksTab";
import LeaderboardTab from "../../components/LeaderboardTab";
import MembersTab from "../../components/MembersTab";
import PredictionsTab from "../../components/PredictionsTab";
import StandingsTab from "../../components/StandingsTab";
import { invalidateApiCache } from "../../lib/api-cache";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { trackEvent } from "../../analytics/ga";
import styles from "./GroupDetailPage.module.css";
import { useGroupTabs, TAB_LABELS } from "./useGroupTabs";
import { useGroupActions } from "./useGroupActions";

interface User {
  id: string;
  email: string;
  nickname?: string;
  avatar_url?: string;
  feature_flags?: {
    create_group?: boolean;
  };
}

interface GroupDetail {
  id: string;
  name: string;
  competition_id: string;
  competition_name: string | null;
  is_admin: boolean;
  invite_code: string;
  created_at: string;
  points_exact: number;
  points_winner: number;
  predictions_visibility: string;
  member_count: number;
  user_position: number;
  user_points: number;
  exact_hits: number;
}

interface GroupDetailPageProps {
  user: User;
  onLogout: () => void;
}

export default function GroupDetailPage({
  user,
  onLogout,
}: GroupDetailPageProps) {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabsOffset, setTabsOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const { confirm, confirmDialog } = useConfirm();
  const menuRef = useRef<HTMLDivElement>(null);
  const { activeTab, tabHref, handleTabClick } = useGroupTabs();

  const {
    leaveGroup,
    leaving,
    submitRename,
    renaming,
    renameError,
    setRenameError,
    deleteGroup,
    deleting,
  } = useGroupActions({
    groupId,
    userId: user.id,
    confirm,
    onGroupRenamed: (name) =>
      setGroup((prev) => (prev ? { ...prev, name } : prev)),
  });

  async function handleRenameSubmit(event: React.FormEvent) {
    event.preventDefault();
    const success = await submitRename(renameValue);
    if (success) setRenameOpen(false);
  }

  useDocumentTitle(
    group ? `${group.name} — ${TAB_LABELS[activeTab]}` : undefined,
  );

  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const isAdmin = group?.is_admin ?? false;

  useEffect(() => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    fetch(`${config.apiUrl}/groups/${groupId}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Grupo não encontrado");
        return r.json() as Promise<{ group: GroupDetail }>;
      })
      .then((data) => setGroup(data.group))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [groupId]);

  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;

    const updateOffset = () => setTabsOffset(header.clientHeight);

    updateOffset();

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateOffset);

    if (observer) {
      observer.observe(header);
    } else {
      window.addEventListener("resize", updateOffset);
    }

    return () => {
      observer?.disconnect();
      if (!observer) {
        window.removeEventListener("resize", updateOffset);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  if (!groupId) return <Navigate to="/" replace />;

  function getShareLink() {
    return `${window.location.origin}?convite=${group!.invite_code}`;
  }

  async function copyCode() {
    await navigator.clipboard.writeText(group!.invite_code);
    trackEvent("click_group_detail_copiar_codigo");
    setCopied("code");
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(getShareLink());
    trackEvent("click_group_detail_copiar_link");
    setCopied("link");
    setTimeout(() => setCopied(null), 2000);
  }

  function handleGroupCreated(nextGroup: { id: string }) {
    invalidateApiCache("groups:");
    navigate(`/grupos/${nextGroup.id}`);
  }

  function handleGroupJoined(nextGroup: { id: string }) {
    invalidateApiCache("groups:");
    navigate(`/grupos/${nextGroup.id}`);
  }

  function openRename() {
    if (!group) return;
    trackEvent("click_group_detail_menu_editar_nome");
    setMenuOpen(false);
    setRenameValue(group.name);
    setRenameError(null);
    setRenameOpen(true);
  }

  const modals = (
    <>
      <CreateGroupModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleGroupCreated}
      />
      <JoinGroupModal
        isOpen={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={handleGroupJoined}
      />
      <Modal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Editar nome do grupo"
      >
        <form onSubmit={handleRenameSubmit} className={styles.renameForm}>
          <input
            className={styles.renameInput}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={50}
            placeholder="Nome do grupo"
            autoFocus
          />
          {renameError && <p className={styles.renameError}>{renameError}</p>}
          <div className={styles.renameActions}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRenameOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={renaming}>
              {renaming ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </>
  );

  if (loading) {
    return (
      <>
        <Header
          user={user}
          onCreateGroup={() => setCreateOpen(true)}
          onJoinGroup={() => setJoinOpen(true)}
          onLogout={onLogout}
        />
        <main className={styles.root}>
          <p className={styles.loadingText}>Carregando grupo...</p>
        </main>
        {modals}
      </>
    );
  }

  if (error || !group) {
    return (
      <>
        <Header
          user={user}
          onCreateGroup={() => setCreateOpen(true)}
          onJoinGroup={() => setJoinOpen(true)}
          onLogout={onLogout}
        />
        <main className={styles.root}>
          <div className={styles.errorBox}>
            {error ?? "Grupo não encontrado"}
          </div>
        </main>
        {modals}
      </>
    );
  }

  return (
    <>
      <Header
        user={user}
        onCreateGroup={() => setCreateOpen(true)}
        onJoinGroup={() => setJoinOpen(true)}
        onLogout={onLogout}
      />
      <main className={styles.root}>
        {/* Group header */}
        <div className={styles.groupHeader}>
          <div className={styles.groupMeta}>
            <span className={styles.competition}>
              {group.competition_name ?? group.competition_id}
            </span>
            <div className={styles.groupNameRow}>
              <h1 className={styles.groupName}>{group.name}</h1>
              <div className={styles.menuWrap} ref={menuRef}>
                <button
                  className={styles.kebabBtn}
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="Opções do grupo"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div className={styles.menu} role="menu">
                    {isAdmin ? (
                      <>
                        <button
                          className={styles.menuItemNeutral}
                          role="menuitem"
                          onClick={openRename}
                        >
                          Editar nome
                        </button>
                        <button
                          className={styles.menuItem}
                          role="menuitem"
                          onClick={deleteGroup}
                          disabled={deleting}
                        >
                          {deleting ? "Excluindo..." : "Excluir grupo"}
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.menuItem}
                        role="menuitem"
                        onClick={leaveGroup}
                        disabled={leaving}
                      >
                        {leaving ? "Saindo..." : "Sair do grupo"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className={styles.groupActions}>
            <div className={styles.stats}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{group.member_count}</span>
                <span className={styles.statLabel}>membros</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>#{group.user_position}</span>
                <span className={styles.statLabel}>sua posição</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{group.user_points}</span>
                <span className={styles.statLabel}>pontos</span>
              </div>
            </div>
          </div>
        </div>

        {/* Admin: invite section */}
        {isAdmin && (
          <div className={styles.inviteSection}>
            <h2 className={styles.inviteTitle}>Convidar membros</h2>
            <div className={styles.inviteRow}>
              <div className={styles.codeBox}>
                <span className={styles.codeLabel}>Código</span>
                <div className={styles.codeValueRow}>
                  <span className={styles.code}>{group.invite_code}</span>
                  <button className={styles.copyBtn} onClick={copyCode}>
                    {copied === "code" ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </div>
              <div className={styles.linkBox}>
                <span className={styles.codeLabel}>Link direto</span>
                <div className={styles.linkValueRow}>
                  <span className={styles.linkText}>{getShareLink()}</span>
                  <button className={styles.copyBtn} onClick={copyLink}>
                    {copied === "link" ? "Copiado!" : "Copiar link"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div
          className={styles.tabs}
          style={{ "--tabs-offset": `${tabsOffset}px` } as CSSProperties}
          data-testid="group-tabs"
        >
          <a
            href={tabHref("predictions")}
            className={`${styles.tab} ${activeTab === "predictions" ? styles.tabActive : ""}`}
            onClick={(e) => handleTabClick(e, "predictions")}
          >
            Palpitar
          </a>
          <a
            href={tabHref("standings")}
            className={`${styles.tab} ${activeTab === "standings" ? styles.tabActive : ""}`}
            onClick={(e) => handleTabClick(e, "standings")}
          >
            Tabela
          </a>
          <a
            href={tabHref("group-picks")}
            className={`${styles.tab} ${activeTab === "group-picks" ? styles.tabActive : ""}`}
            onClick={(e) => handleTabClick(e, "group-picks")}
          >
            Grupo
          </a>
          <a
            href={tabHref("leaderboard")}
            className={`${styles.tab} ${activeTab === "leaderboard" ? styles.tabActive : ""}`}
            onClick={(e) => handleTabClick(e, "leaderboard")}
          >
            Ranking
          </a>
          {isAdmin && (
            <a
              href={tabHref("members")}
              className={`${styles.tab} ${activeTab === "members" ? styles.tabActive : ""}`}
              onClick={(e) => handleTabClick(e, "members")}
            >
              Membros
            </a>
          )}
        </div>

        <div className={styles.tabContent}>
          {activeTab === "predictions" && (
            <PredictionsTab
              groupId={groupId}
              competitionId={group.competition_id}
              pointsExact={group.points_exact}
            />
          )}
          {activeTab === "standings" && (
            <StandingsTab competitionId={group.competition_id} />
          )}
          {activeTab === "group-picks" && (
            <GroupPicksTab
              groupId={groupId}
              competitionId={group.competition_id}
            />
          )}
          {activeTab === "leaderboard" && (
            <LeaderboardTab groupId={groupId} currentUserId={user.id} />
          )}
          {activeTab === "members" && isAdmin && (
            <MembersTab groupId={groupId} currentUserId={user.id} />
          )}
        </div>
      </main>
      {modals}
    </>
  );
}
