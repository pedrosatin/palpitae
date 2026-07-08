import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { config } from "../../config";
import { invalidateApiCache } from "../../lib/api-cache";
import { trackEvent } from "../../analytics/ga";
import { useConfirm } from "../../components/ConfirmModal";

export function useGroupActions({
  groupId,
  userId,
  confirm,
  onGroupRenamed,
}: {
  groupId: string | undefined;
  userId: string;
  confirm: ReturnType<typeof useConfirm>["confirm"];
  onGroupRenamed: (name: string) => void;
}) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  async function leaveGroup() {
    if (!groupId) return;
    trackEvent("click_group_detail_menu_sair");

    const ok = await confirm({
      title: "Sair do grupo",
      message: "Tem certeza que deseja sair deste grupo?",
      confirmLabel: "Sair",
      danger: true,
    });
    if (!ok) return;

    setLeaving(true);

    try {
      const res = await fetch(
        `${config.apiUrl}/groups/${groupId}/members/${userId}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Erro ao sair do grupo");
      }

      invalidateApiCache("groups:");
      navigate("/", { replace: true });
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Erro ao sair do grupo");
    } finally {
      setLeaving(false);
    }
  }

  async function submitRename(name: string) {
    if (!groupId) return;

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      setRenameError("Nome deve ter entre 2 e 50 caracteres");
      return false;
    }

    setRenaming(true);
    setRenameError(null);

    try {
      const res = await fetch(`${config.apiUrl}/groups/${groupId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Erro ao renomear grupo");
      }

      trackEvent("submit_renomear_grupo");
      onGroupRenamed(trimmedName);
      invalidateApiCache("groups:");
      return true;
    } catch (e: unknown) {
      setRenameError(e instanceof Error ? e.message : "Erro ao renomear grupo");
      return false;
    } finally {
      setRenaming(false);
    }
  }

  async function deleteGroup() {
    if (!groupId) return;
    trackEvent("click_group_detail_menu_excluir");

    const ok = await confirm({
      title: "Excluir grupo",
      message:
        "Tem certeza que deseja excluir este grupo? Ele deixará de aparecer para todos os membros.",
      confirmLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;

    setDeleting(true);

    try {
      const res = await fetch(`${config.apiUrl}/groups/${groupId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Erro ao excluir grupo");
      }

      invalidateApiCache("groups:");
      navigate("/", { replace: true, state: { refreshGroups: true } });
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Erro ao excluir grupo");
    } finally {
      setDeleting(false);
    }
  }

  return {
    leaveGroup,
    leaving,
    submitRename,
    renaming,
    renameError,
    setRenameError,
    deleteGroup,
    deleting,
  };
}
