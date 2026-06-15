export function GuaranteeCard() {
  return (
    <div
      data-section="guarantee"
      className="bg-white rounded-[10px] p-4 mb-3 flex gap-3.5 items-start"
    >
      <div className="w-[56px] h-[56px] rounded-full bg-[#c8620a] text-white flex items-center justify-center text-[7.5px] font-bold text-center leading-[1.3] p-1.5 flex-shrink-0">
        30 DAY<br />MONEY<br />BACK
      </div>
      <div>
        <p className="text-[9px] text-[#999] uppercase tracking-[0.1em] mb-1">
          The Empty-Bottle Promise
        </p>
        <h2 className="text-[15px] font-bold italic text-[#1a3028] leading-[1.3] mb-2">
          30-day money-back guarantee — even if the bottle is empty.
        </h2>
        <p className="text-[12px] text-[#666] leading-[1.6]">
          Take it daily for the full thirty days. If you don't feel sharper,
          calmer, more even — ship the bottles back (full, half, or empty)
          and we'll refund every dollar. No restocking fee, no friction, no
          questions.
        </p>
        <div className="flex flex-wrap gap-4 mt-2 text-[11px] text-[#3a6a4a] font-medium">
          <span>✓ Refunds processed in 3 business days</span>
          <span>✓ Keep any free gifts</span>
        </div>
      </div>
    </div>
  );
}
