import { calculateCatering, CateringSettings } from './catering';

const S: CateringSettings = {
  maybeWeightPercent: 50,
  pendingWeightPercent: 0,
  bufferPercent: 0,
  mealRounding: 1,
  adultPricePaise: null,
  childPricePaise: null,
};
const none = { confirmedAdults: 0, confirmedChildren: 0, maybeAdults: 0, maybeChildren: 0, pendingPeople: 0 };

describe('calculateCatering', () => {
  it('counts only confirmed people when maybe/pending weights are zero', () => {
    const r = calculateCatering(
      { ...none, confirmedAdults: 40, confirmedChildren: 10, maybeAdults: 20, pendingPeople: 30 },
      { ...S, maybeWeightPercent: 0 },
    );
    expect(r).toMatchObject({ adultMeals: 40, childMeals: 10, estimatedMeals: 50 });
  });
  it('weights maybes and pending, then applies the buffer and rounds meals up', () => {
    const r = calculateCatering(
      { confirmedAdults: 40, confirmedChildren: 10, maybeAdults: 10, maybeChildren: 4, pendingPeople: 20 },
      { ...S, pendingWeightPercent: 25, bufferPercent: 10 },
    );
    // adults: 40 + 5 + 5 = 50 -> x1.1 = 55 ; children: 10 + 2 = 12 -> 13.2 -> 14
    expect(r.adultMeals).toBe(55);
    expect(r.childMeals).toBe(14);
    expect(r.estimatedMeals).toBe(69);
  });
  it('is not fooled by floating point noise (10 x 1.1)', () => {
    expect(calculateCatering({ ...none, confirmedAdults: 10 }, { ...S, bufferPercent: 10 }).adultMeals).toBe(11);
  });
  it("rounds the total up to the caterer's multiple and bills extras as adult meals", () => {
    const r = calculateCatering(
      { ...none, confirmedAdults: 21, confirmedChildren: 2 },
      { ...S, mealRounding: 10, adultPricePaise: 1000, childPricePaise: 500 },
    );
    expect(r.estimatedMeals).toBe(30);
    expect(r.breakdown.roundingAdded).toBe(7);
    expect(r.estimatedCostPaise).toBe(28 * 1000 + 2 * 500);
  });
  it('returns no cost when a needed price is unknown, and zero cost for zero meals', () => {
    expect(
      calculateCatering({ ...none, confirmedAdults: 5, confirmedChildren: 1 }, { ...S, adultPricePaise: 100 }).estimatedCostPaise,
    ).toBeNull();
    expect(calculateCatering({ ...none, confirmedAdults: 5 }, { ...S, adultPricePaise: 100 }).estimatedCostPaise).toBe(500);
    expect(calculateCatering(none, S)).toMatchObject({ estimatedMeals: 0, estimatedCostPaise: 0 });
  });
});
