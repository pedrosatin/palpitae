import { useCallback, useEffect, useState } from "react";
import { config } from "../../config";
import { trackEvent } from "../../analytics/ga";
import { apiFetch } from "../../lib/api";
import ErrorState from "../ErrorState";
import PredictionsModal from "./PredictionsModal";
import styles from "./LeaderboardTab.module.css";
import type { Member } from "./types";

interface LeaderboardTabProps {
  groupId: string;
  currentUserId: string;
}

export default function LeaderboardTab({
  groupId,
  currentUserId,
}: LeaderboardTabProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(`${config.apiUrl}/groups/${groupId}/members`)
      .then((r) => {
        if (!r.ok) throw new Error("Erro ao carregar membros");
        return r.json() as Promise<{ members: Member[] }>;
      })
      .then((data) => setMembers(data.members))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [groupId]);

  const openMemberModal = useCallback((member: Member) => {
    trackEvent("click_leaderboard_ver_palpites");
    setSelectedMember(member);
  }, []);

  const closeModal = useCallback(() => {
    setSelectedMember(null);
  }, []);

  if (loading) {
    return <p className={styles.loading}>Carregando classificação...</p>;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  if (members.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Nenhum membro encontrado.</p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.root}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPos}>#</th>
              <th className={styles.thName}>Jogador</th>
              <th className={styles.thPts}>Pontos</th>
              <th className={styles.thExact}>Exatos</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, index) => (
              <tr
                key={member.user_id}
                className={
                  member.user_id === currentUserId ? styles.rowSelf : styles.row
                }
                onClick={() => openMemberModal(member)}
                title={`Ver palpites de ${member.display_name}`}
              >
                <td className={styles.tdPos}>{index + 1}</td>
                <td className={styles.tdName}>
                  {member.avatar_url ? (
                    <img
                      src={member.avatar_url}
                      alt=""
                      className={styles.avatar}
                    />
                  ) : (
                    <span className={styles.avatarFallback}>
                      {member.display_name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className={styles.displayName}>
                    {member.display_name}
                  </span>
                  {member.role === "owner" && (
                    <span className={styles.ownerBadge}>admin</span>
                  )}
                  {member.user_id === currentUserId && (
                    <span className={styles.youBadge}>você</span>
                  )}
                </td>
                <td className={styles.tdPts}>{member.total_points}</td>
                <td className={styles.tdExact}>{member.exact_hits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedMember && (
        <PredictionsModal
          member={selectedMember}
          groupId={groupId}
          onClose={closeModal}
        />
      )}
    </>
  );
}
