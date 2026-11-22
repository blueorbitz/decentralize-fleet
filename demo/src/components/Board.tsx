import { colors, font } from '../theme';
import Lozenge from './Lozenge';

export type BoardTicket = {
  key: string;
  summary: string;
  status: string;
  labels?: string[];
  lease?: string;
  worker?: string;
  pr?: string;
};

const COLUMNS = ['Triaged', 'Ready for Build', 'In Build', 'In Review', 'Done'];

// The board, as the Jira Kanban reads at a glance. Columns are fixed so the
// eye can follow a ticket moving across them.
export default function Board({
  tickets,
  highlight,
  width = 1240,
}: {
  tickets: BoardTicket[];
  highlight?: string;
  width?: number;
}) {
  const columns = COLUMNS.map((status) => ({
    status,
    tickets: tickets.filter((t) => t.status === status),
  }));

  return (
    <div style={{ width }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: colors.n1000 }}>FLT board</span>
        <span style={{ fontSize: 13, color: colors.n500 }}>Jira Software · Kanban</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {columns.map((col) => (
          <div key={col.status} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26 }}>
              <Lozenge status={col.status} size="sm" />
              <span style={{ fontSize: 12, color: colors.n500 }}>{col.tickets.length}</span>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 210,
                padding: 8,
                borderRadius: 8,
                backgroundColor: colors.n20,
              }}
            >
              {col.tickets.map((t) => (
                <TicketCard key={t.key} ticket={t} focused={t.key === highlight} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketCard({ ticket, focused }: { ticket: BoardTicket; focused: boolean }) {
  return (
    <div
      style={{
        padding: '10px 11px',
        borderRadius: 6,
        backgroundColor: colors.n0,
        border: `1px solid ${colors.n40}`,
        boxShadow: focused
          ? `0 0 0 2px ${colors.b300}, 0 10px 22px rgba(9,30,66,0.16)`
          : '0 1px 2px rgba(9,30,66,0.10)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.n500, marginBottom: 4 }}>
        {ticket.key}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.35, color: colors.n1000 }}>{ticket.summary}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
        {(ticket.labels || []).map((l) => (
          <span
            key={l}
            style={{
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: colors.n20,
              border: `1px solid ${colors.n40}`,
              fontSize: 10.5,
              color: colors.n700,
              fontFamily: font.sans,
            }}
          >
            {l}
          </span>
        ))}
        {ticket.worker ? (
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: colors.b50,
              fontSize: 10.5,
              color: colors.b400,
              fontWeight: 600,
            }}
          >
            {ticket.worker}
          </span>
        ) : null}
        {ticket.lease ? (
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: colors.lozYellow,
              fontSize: 10.5,
              color: colors.lozYellowText,
              fontFamily: font.mono,
            }}
          >
            {ticket.lease}
          </span>
        ) : null}
        {ticket.pr ? (
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 3,
              backgroundColor: colors.lozGreen,
              fontSize: 10.5,
              color: colors.lozGreenText,
              fontWeight: 600,
            }}
          >
            PR
          </span>
        ) : null}
      </div>
    </div>
  );
}
