# SCOPE/1 waveform and binary reference

Waveform identifier: `triangle-modulated-v1`. Values are normalized illustrative amplitudes, not
volts. Readers reject unknown waveform identifiers instead of guessing a formula.

For original zero-based frame index n, zero-based channel c, sample rate r, and seed s:

1. P = max(8, round(r / (2 + 0.37 × c))).
2. Q = max(4, round(P / 7)).
3. A = ((n mod P) + ((97 × c + s) mod P)) mod P.
4. B = ((n mod Q) + (s mod Q)) mod Q.
5. triangle(p, L) = 1 − 4 × abs(p / L − 0.5).
6. value = float32(0.8 × triangle(A, P) + 0.12 × triangle(B, Q)).

Use IEEE-754 binary64 intermediate arithmetic in the stated order, nonnegative remainder, and
positive half-up rounding for P and Q. Convert to IEEE-754 binary32 once, at the end, with
round-to-nearest/ties-to-even. Do not round either triangle contribution to float32 separately. The
stored value is compared exactly to that final binary32 value; nonfinite observations are incorrect.

## Independently checked reference values

The period and phase columns make each fixture reproducible without the application source. Values
were independently calculated using Python rational arithmetic for the triangle contributions, then
packed with `struct.pack('<f', ...)`; the shown fixtures agree with the specified
binary64-intermediate calculation. Fractions are explanatory reference calculations, not a change to
the required rounding algorithm.

| Rate r | Seed s | Channel c | Index n | P    | Q   | A   | B   | Final float32 value  | Little-endian bytes |
| ------ | ------ | --------- | ------- | ---- | --- | --- | --- | -------------------- | ------------------- |
| 4000   | 42     | 0         | 0       | 2000 | 286 | 42  | 42  | -0.7823104858398438  | 80 45 48 bf         |
| 1000   | 7      | 0         | 0       | 500  | 71  | 7   | 7   | -0.8278760313987732  | af ef 53 bf         |
| 1000   | 7      | 7         | 499     | 218  | 31  | 95  | 10  | 0.6293341517448425   | 0b 1c 21 3f         |
| 200    | 123    | 2         | 0       | 73   | 10  | 25  | 3   | 0.31989040970802307  | ad c8 a3 3e         |
| 200    | 123    | 2         | 49      | 73   | 10  | 1   | 2   | -0.780164361000061   | da b8 47 bf         |
| 4000   | 42     | 31        | 7999    | 297  | 42  | 59  | 19  | -0.06716690957546234 | ce 8e 89 bd         |

Example: r=1000, s=7, c=0, n=0 gives a rational triangle combination of −36737/44375. Its nearest
binary32 representation is −0.8278760313987732, stored as `af ef 53 bf`.

## Reading frames

Each frame starts with an eight-byte little-endian unsigned original frame index, then one
little-endian float32 per channel in ascending channel order. Width is `8 + 4 × channels` bytes. At
physical record ordinal k, channel c starts at byte `k × width + 8 + 4 × c`. Read the stored index
at `k × width` to obtain n; gaps mean that n need not equal k.

Metadata records `format`, `waveform`, `sampleRate`, `channels`, `seed`, `recordBytes`, and the
expected final frame extent. For a lossless timed run, extent is `floor(seconds × sampleRate)`, and
scalar count is extent × channels. Actual source duration is extent / sampleRate; requested duration
remains in `seconds`.

Reference tests inspect binary bytes from real captures instead of importing the production sample
function to calculate expected values. The default two-second test also checks the first and last
stored original indices.
