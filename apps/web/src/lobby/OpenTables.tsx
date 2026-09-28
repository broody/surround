import { useState } from "react";
import { StoneDot } from "../components/ui";
import { Avatar, LobbyPanel, PRESENCE_LABEL } from "./LobbyParts";
import { paceById, TABLES, type BoardSize } from "./lobbyData";

const FILTERS: (BoardSize | "all")[] = ["all", 9, 13, 19];

export default function OpenTables({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [filter, setFilter] = useState<BoardSize | "all">("all");
  const [requested, setRequested] = useState<string | null>(null);
  const tables = TABLES.filter(
    (table) => filter === "all" || table.size === filter,
  );

  return (
    <LobbyPanel
      title="Open tables"
      subtitle="Join a table with an open seat"
      className="lobby-tables"
    >
      <div
        className="lobby-filters mt-5 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by board size"
      >
        {FILTERS.map((option) => {
          const count = TABLES.filter(
            (table) => option === "all" || table.size === option,
          ).length;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {option === "all" ? "All" : `${option} × ${option}`}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="lobby-table-scroll mt-3 min-h-0 flex-1">
        <table className="lobby-table w-full">
          <thead>
            <tr>
              <th scope="col">Host</th>
              <th scope="col">Rank</th>
              <th scope="col">Size</th>
              <th scope="col">Pace</th>
              <th scope="col">Seats</th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tables.map((table) => {
              const pace = paceById(table.pace);
              const isRequested = requested === table.id;
              return (
                <tr key={table.id} className={isRequested ? "is-requested" : ""}>
                  <td className="lobby-host">
                    <Avatar src={table.portrait} presence={table.presence} />
                    <span className="flex min-w-0 flex-col">
                      <strong>{table.host}</strong>
                      <small>{table.note}</small>
                      <span className="sr-only">
                        {PRESENCE_LABEL[table.presence]}
                      </span>
                    </span>
                  </td>
                  <td data-label="Rank">{table.rank}</td>
                  <td data-label="Size">
                    {table.size} × {table.size}
                  </td>
                  <td data-label="Pace">
                    <span className="flex flex-col">
                      <span
                        className={
                          pace.label === "Ranked" ? "lobby-ranked" : undefined
                        }
                      >
                        {pace.label}
                      </span>
                      <small>{pace.clock}</small>
                    </span>
                  </td>
                  <td data-label="Seats">
                    <span className="lobby-seats">
                      <StoneDot color="black" />
                      <span
                        className="lobby-open-seat"
                        title="Open seat: you would play White"
                      />
                      <span>1/2</span>
                    </span>
                  </td>
                  <td className="lobby-action">
                    <button
                      type="button"
                      className="lobby-join"
                      aria-label={
                        isRequested
                          ? `Withdraw request to join ${table.host}`
                          : `Join ${table.host}'s table as White`
                      }
                      onClick={() => {
                        setRequested(isRequested ? null : table.id);
                        onNotice(
                          isRequested
                            ? `Request to join ${table.host} withdrawn.`
                            : `${table.host}’s table is a sample. Joining isn’t connected in this preview.`,
                        );
                      }}
                    >
                      {isRequested ? "Asked" : "Join"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </LobbyPanel>
  );
}
