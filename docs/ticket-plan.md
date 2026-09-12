# SCOPE implementation tickets

Status: approved and published. [Parent specification #1](https://github.com/GowthamTG/anthriq/issues/1) remains unchanged.

All 18 tickets are open and labeled `ready-for-agent` at publication. Seventeen deliver the complete local assessment; the eighteenth is optional hosting. GitHub contains all 29 native blocking relationships, mirrored as readable links in each issue body. The bodies, labels, and dependencies were verified after publication.

T01–T18 retain the approved planning identifiers; GitHub issue numbers are #2–#19. Individual publication snapshots are in `tickets/`; GitHub is authoritative for current work status. `published-tickets.json` records the exact issue mapping and verified graph.

## Published tickets

1. **[[T01] Launch locally, capture a nominal signal, and inspect the saved result](https://github.com/GowthamTG/anthriq/issues/2)**
   - **GitHub issue:** #2. **Blocked by:** None; can start immediately.
   - **Delivers:** One documented local command opens a minimal React workbench; Start runs the real default-rate generator and recorder, and Stop produces an inspectable recording. The same narrow workflow works through the CLI.

2. **[[T02] Configure acquisitions and reproduce exact signal values](https://github.com/GowthamTG/anthriq/issues/3)**
   - **GitHub issue:** #3. **Blocked by:** [#2](https://github.com/GowthamTG/anthriq/issues/2).
   - **Delivers:** An operator chooses channels, sample rate, seed, and duration in the UI or CLI, records that exact configuration, and reproduces any stored channel value independently.

3. **[[T03] Browse self-describing recordings and inspect incomplete prefixes](https://github.com/GowthamTG/anthriq/issues/4)**
   - **GitHub issue:** #4. **Blocked by:** [#2](https://github.com/GowthamTG/anthriq/issues/2).
   - **Delivers:** A reviewer opens the recordings library, inspects any saved recording, and understands its format, counts, completion state, and readable prefix without reading the whole signal.

4. **[[T04] Stop safely and surface process or disk failures](https://github.com/GowthamTG/anthriq/issues/5)**
   - **GitHub issue:** #5. **Blocked by:** [#2](https://github.com/GowthamTG/anthriq/issues/2).
   - **Delivers:** Stopping, interrupting, or losing a child process produces a truthful final state, preserves readable data, and never leaves the operator waiting indefinitely.

5. **[[T05] Demonstrate bounded overload loss and recorder recovery](https://github.com/GowthamTG/anthriq/issues/6)**
   - **GitHub issue:** #6. **Blocked by:** [#3](https://github.com/GowthamTG/anthriq/issues/3), [#5](https://github.com/GowthamTG/anthriq/issues/5).
   - **Delivers:** A reviewer deliberately slows recording, sees the source remain clock-paced, and gets exact lost intervals plus successful recovery when recording catches up.

6. **[[T06] Verify recordings through the CLI and workbench](https://github.com/GowthamTG/anthriq/issues/7)**
   - **GitHub issue:** #7. **Blocked by:** [#3](https://github.com/GowthamTG/anthriq/issues/3).
   - **Delivers:** A reviewer runs verification from the CLI or UI and receives a trustworthy streaming report with separate discrepancy counts, first positions, progress, and a machine-checkable result.

7. **[[T07] Demonstrate integrity failures using disposable recordings](https://github.com/GowthamTG/anthriq/issues/8)**
   - **GitHub issue:** #8. **Blocked by:** [#4](https://github.com/GowthamTG/anthriq/issues/4), [#7](https://github.com/GowthamTG/anthriq/issues/7).
   - **Delivers:** The Verify view offers a safe demonstration that creates disposable damaged fixtures and visibly explains which samples are missing, duplicated, or incorrect.

8. **[[T08] Inspect exact time ranges and channel subsets](https://github.com/GowthamTG/anthriq/issues/9)**
   - **GitHub issue:** #9. **Blocked by:** [#3](https://github.com/GowthamTG/anthriq/issues/3), [#4](https://github.com/GowthamTG/anthriq/issues/4).
   - **Delivers:** An operator selects a recording, enters time or original-index bounds and channels, and inspects the exact requested observations without scanning the whole file.

9. **[[T09] Export selected observations as CSV and JSON-lines](https://github.com/GowthamTG/anthriq/issues/10)**
   - **GitHub issue:** #10. **Blocked by:** [#9](https://github.com/GowthamTG/anthriq/issues/9).
   - **Delivers:** An operator exports the selected time range and channels from the recording detail, or streams machine-readable observations from the CLI, without loading the full export.

10. **[[T10] Play a recording at its native rate](https://github.com/GowthamTG/anthriq/issues/11)**
   - **GitHub issue:** #11. **Blocked by:** [#9](https://github.com/GowthamTG/anthriq/issues/9).
   - **Delivers:** An operator opens a saved recording and plays the actual selected samples at their native rate, with truthful position and timing metrics in the detail view.

11. **[[T11] Pause, seek, and change playback speed without losing position](https://github.com/GowthamTG/anthriq/issues/12)**
   - **GitHub issue:** #12. **Blocked by:** [#11](https://github.com/GowthamTG/anthriq/issues/11).
   - **Delivers:** The operator can pause/resume, seek precisely, and change speed or channels while preserving a correct sample sequence and a responsive playback view.

12. **[[T12] Watch live channel traces with measured acquisition health](https://github.com/GowthamTG/anthriq/issues/13)**
   - **GitHub issue:** #13. **Blocked by:** [#3](https://github.com/GowthamTG/anthriq/issues/3).
   - **Delivers:** During acquisition the operator sees real selected-channel waveforms and precise source, recorder, buffer, and timing metrics in a polished instrument view.

13. **[[T13] Keep acquisition independent of slow or disconnected browsers](https://github.com/GowthamTG/anthriq/issues/14)**
   - **GitHub issue:** #14. **Blocked by:** [#5](https://github.com/GowthamTG/anthriq/issues/5), [#13](https://github.com/GowthamTG/anthriq/issues/13).
   - **Delivers:** A slow tab, disconnected browser, or reopened workbench gets an honest current view while the acquisition processes continue recording independently.

14. **[[T14] Complete the accessible instrument workflow across all views](https://github.com/GowthamTG/anthriq/issues/15)**
   - **GitHub issue:** #15. **Blocked by:** [#8](https://github.com/GowthamTG/anthriq/issues/8), [#10](https://github.com/GowthamTG/anthriq/issues/10), [#12](https://github.com/GowthamTG/anthriq/issues/12), [#14](https://github.com/GowthamTG/anthriq/issues/14).
   - **Delivers:** A reviewer can move smoothly from acquisition through recordings, export, playback, and verification using either mouse or keyboard, with a consistent premium instrument UI.

15. **[[T15] Prove sustained zero-loss acquisition and bounded memory](https://github.com/GowthamTG/anthriq/issues/16)**
   - **GitHub issue:** #16. **Blocked by:** [#6](https://github.com/GowthamTG/anthriq/issues/6), [#7](https://github.com/GowthamTG/anthriq/issues/7), [#14](https://github.com/GowthamTG/anthriq/issues/14).
   - **Delivers:** The reviewer can reproduce a sustained acquisition benchmark and inspect measured timing, memory, loss accounting, and a clean validation report instead of relying on claims.

16. **[[T16] Measure seeking, export, playback, and verification on a long recording](https://github.com/GowthamTG/anthriq/issues/17)**
   - **GitHub issue:** #17. **Blocked by:** [#10](https://github.com/GowthamTG/anthriq/issues/10), [#12](https://github.com/GowthamTG/anthriq/issues/12), [#16](https://github.com/GowthamTG/anthriq/issues/16).
   - **Delivers:** The reviewer sees reproducible evidence that small queries, export, playback controls, and verification remain correct and memory-bounded on the sustained recording.

17. **[[T17] Deliver a reproducible repository and complete demonstration video](https://github.com/GowthamTG/anthriq/issues/18)**
   - **GitHub issue:** #18. **Blocked by:** [#15](https://github.com/GowthamTG/anthriq/issues/15), [#17](https://github.com/GowthamTG/anthriq/issues/17).
   - **Delivers:** A hiring reviewer receives a repository that runs from a fresh setup, documents every assessment requirement, and includes a short truthful capture-to-verification demonstration.

18. **[[T18] Optionally publish an easy-to-run public demo after local delivery](https://github.com/GowthamTG/anthriq/issues/19)**
   - **GitHub issue:** #19. **Blocked by:** [#18](https://github.com/GowthamTG/anthriq/issues/18).
   - **Delivers:** Only after the assessment handoff is complete, evaluate a straightforward public demonstration and publish it if the hosting model can honestly support the product without jeopardizing delivery.

## Work order

Start with [#2: local capture](https://github.com/GowthamTG/anthriq/issues/2), the only issue with no blockers. Once it completes, configuration (#3), recording inspection (#4), and shutdown/failure handling (#5) become independent follow-on workflows.

The sustained acquisition benchmark (#16) can proceed once overload, verification, and browser isolation are complete, without waiting for playback controls or final UI polish. Long-recording measurements (#17) and the complete reviewer UI workflow (#15) converge on final submission (#18).

Optional public hosting (#19) is blocked by the finished local submission and never gates it. A ready-for-agent label means the ticket is fully specified; implementation starts only after its blocking issues are complete.

## Coverage

- **A01:** T01, T06, T15
- **A02:** T02
- **A03:** T02
- **A04:** T01
- **A05:** T05, T12, T15
- **A06:** T05, T15
- **A07:** T05, T15
- **A08:** T01, T04
- **A09:** T04
- **A10:** T03, T04
- **A11:** T03
- **A12:** T08
- **A13:** T08
- **A14:** T08, T16
- **A15:** T09, T16
- **A16:** T10, T16
- **A17:** T11, T16
- **A18:** T11, T16
- **A19:** T11, T16
- **A20:** T10, T11, T16
- **A21:** T06, T07
- **A22:** T06, T07
- **A23:** T06, T07
- **A24:** T06, T07
- **A25:** T02, T03, T06, T08
- **A26:** T06
- **A27:** T12, T13, T15
- **A28:** T01, T03, T04, T07, T08, T09, T10, T11, T12, T13, T14
- **A29:** T06, T14, T15
- **A30:** T01, T14, T17

All 56 user stories have at least one ticket owner. T17 additionally performs the complete assessment and submission audit.
