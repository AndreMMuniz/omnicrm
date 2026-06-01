export default function ClientOpportunitiesPage() {
  return (
    <main className="flex h-full min-h-0 flex-col bg-[#F8F9FA]">
      <section className="border-b border-[#E9ECEF] bg-white px-6 py-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Clients</p>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-slate-900">Opportunities</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
            Phase 1
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Esta rota abre o espa&ccedil;o para a futura gest&atilde;o comercial em formato de tabela e side panel.
        </p>
      </section>
      <section className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="max-w-xl rounded-[28px] border border-dashed border-slate-300 bg-white px-8 py-10 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Coming next</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-900">
            Opportunities workspace
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            O objetivo aqui &eacute; convergir para o mesmo padr&atilde;o do Twenty, com lista persistente e detalhe lateral.
          </p>
        </div>
      </section>
    </main>
  );
}
