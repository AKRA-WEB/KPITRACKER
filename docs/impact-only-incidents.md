# Impact-only Incident contract (20260908-004)

Released frontend: `20260908.01`. Impact-only recording is active for AKRA and TRD from September 8, 2026, 11:40 Asia/Bangkok. The migration itself seeds the catalog disabled; activation is a separate server operation.

## Selection and storage

Quick buttons and search select the same stable type ID. An explicit allowed impact is required. Edge resolves the name/category from the current catalog revision; it never substitutes another type or penalty. New cases use `schemaVersion: 3`, `scoringMode: "none"` and compatibility `penalty: 0`. The zero value is not used to infer success, severity or Good Catch.

Types allow `contained`, `escaped_internal`, `reached_customer`, `unknown`, or `not_applicable` as declared by the catalog. Shipping/picking types exclude `not_applicable`; shared housekeeping/attendance types currently allow `not_applicable` and `unknown`. Administrators may edit names, categories, quick flags and allowed impacts; retire a type by deactivating its stable ID. Catalog writes use a compare-and-swap revision and preserve activation fields.

Daily storage retains existing participant projections. The new RPC locks the branch/day, validates projections and changes the full case atomically with an append-only revision containing actor, reason and before/after snapshots. Create/retry, same-day update and same-day cancellation use stable case IDs and optimistic revisions. Edits preserve original participants unless the operator explicitly changes them.

New ordinary legacy writes are blocked at both API and database boundaries after activation. Explicit positive achievements and authorized Zero Error declarations have a narrow compatibility route which cannot replace or resurrect an audited Incident ID. Anonymous/authenticated roles cannot call these RPCs or read revision storage directly. History is authorized by branch through kpi-api.

## Consumer inventory

| Consumer | New behavior | Historical compatibility |
| --- | --- | --- |
| Entry form, quick/search, summary | Catalog ID plus explicit impact; immutable confirmed save | Old form only before cutover |
| Timeline and same-day edit/cancel | Impact labels, involved people, reason and revision history | Old scores labeled as historical; old cases may be canceled, not converted |
| Good Catch and Zero Error | Separate positive timeline; no incident count; Zero role/conflict enforcement | Original positive payload shape retained |
| Daily detail and weekly branch cards | Distinct cases, impact totals, individual involvement | Raw old rows unchanged; no inferred new severity from penalty |
| Executive totals, trends and Pareto | Distinct case counts; stable-ID recurrence; impact filters/evidence | Legacy IDs/markers retained, unknown remains explicit |
| CSV exports | One row per case with involved people/impact; no new HP values | Historical HP in dedicated labeled evidence column |
| Employee/My Profile | Incident and customer-impact counts; no quality HP; unavailable on read failure | Other skill/workload metrics retained |
| Weekly LINE report | Explicit impact overrides old label/penalty; distinct cases and stable type recurrence | Legacy label/marker evidence kept; achievements excluded |
| Alternate combined/daily Incident writes | Redirected/rejected; cannot overwrite v3 projections | Unrelated dedicated workload/other-domain saves preserved |

## Explicit legacy-to-new catalog mapping

This maps 31 configured legacy labels to 28 stable IDs. It changes future choices only; no historical row or stored penalty is rewritten.

| Branch | Category | Legacy label | Legacy HP | New type | Stable ID |
| --- | --- | --- | --- | --- | --- |
| AKRA | shared | วางของเกะกะ ขวางทางสัญจร | 3 | วางของเกะกะ ขวางทางสัญจร | `akra-e1d5804d61c7` |
| AKRA | shared | ไม่รักษาความสะอาดพื้นที่ทำงาน | 3 | ไม่รักษาความสะอาดพื้นที่ทำงาน | `akra-9549cf955aad` |
| AKRA | shared | อุปกรณ์ส่วนกลางชำรุดไม่แจ้ง | 5 | อุปกรณ์ส่วนกลางชำรุดไม่แจ้ง | `akra-99ea99eb67cf` |
| AKRA | inbound | วางสินค้าไม่เรียบร้อย/ผิดตำแหน่ง | 3 | วางสินค้าไม่เรียบร้อย/ผิดตำแหน่ง | `akra-24266877ca03` |
| AKRA | inbound | ลงรับสินค้าในแอปผิด | 5 | ลงรับสินค้าในแอปผิด | `akra-c4ce30d6bff5` |
| AKRA | inbound | รับสินค้าชำรุดเข้ามาไม่แจ้ง | 5 | รับสินค้าชำรุดเข้ามาไม่แจ้ง | `akra-b60ac3ad0f35` |
| AKRA | outbound | หยิบผิด แก้ทันก่อนจัดส่ง | 0 | จัดสินค้าผิด | `akra-40310200fe60` |
| AKRA | outbound | หยิบผิด ถึงหน้าร้านแล้ว | 10 | จัดสินค้าผิด | `akra-40310200fe60` |
| AKRA | outbound | หยิบผิด ถึงลูกค้าแล้ว | 20 | จัดสินค้าผิด | `akra-40310200fe60` |
| AKRA | outbound | จำนวนไม่ครบ / ขาดเกิน | 5 | จำนวนไม่ครบ / ขาดเกิน | `akra-33179ed4abc0` |
| AKRA | transfer | จัดของโอนย้าย W2 ผิดรายการ | 5 | จัดของโอนย้าย W2 ผิดรายการ | `akra-75335078361f` |
| AKRA | transfer | จัดของโอนย้าย W2 ขาด/เกิน | 5 | จัดของโอนย้าย W2 ขาด/เกิน | `akra-3dcdf51f0e50` |
| AKRA | transfer | ไม่ลงบันทึกการโอนย้าย | 5 | ไม่ลงบันทึกการโอนย้าย | `akra-aeffd86536bc` |
| AKRA | store_stock | ตกเบิกสต๊อก / ของหมดไม่แจ้ง | 5 | ตกเบิกสต๊อก / ของหมดไม่แจ้ง | `akra-93f962b4dfff` |
| AKRA | store_stock | ปล่อยชั้นวางว่าง / เติมของช้า | 5 | ปล่อยชั้นวางว่าง / เติมของช้า | `akra-2d62f50b2054` |
| AKRA | store_stock | สต๊อกสินค้าไม่พอใช้ / สั่งของช้า | 10 | สต๊อกสินค้าไม่พอใช้ / สั่งของช้า | `akra-f020f42a89c6` |
| TRD | shared | มาทำงานสาย / ขาดงานไม่แจ้ง | 10 | มาทำงานสาย / ขาดงานไม่แจ้ง | `trd-bc3523c19f88` |
| TRD | shared | ร้านค้าไม่สะอาด / ชั้นวางของรก | 5 | ร้านค้าไม่สะอาด / ชั้นวางของรก | `trd-d05685574081` |
| TRD | cashier | คิดเงินทอนเงินผิด | 15 | คิดเงินทอนเงินผิด | `trd-e72f4167d739` |
| TRD | cashier | เปิดบิลผิดรายการ / ผิดสาขา | 10 | เปิดบิลผิดรายการ / ผิดสาขา | `trd-1c33bb5ee2fc` |
| TRD | cashier | ลืมยิงบาร์โค้ด / จำนวนผิด | 10 | ลืมยิงบาร์โค้ด / จำนวนผิด | `trd-2f41a1bdd3c2` |
| TRD | cashier | พูดจาไม่สุภาพ / บริการล่าช้า | 10 | พูดจาไม่สุภาพ / บริการล่าช้า | `trd-4138be583790` |
| TRD | cashier | สินค้าหมดไม่แจ้ง | 5 | สินค้าหมดไม่แจ้ง | `trd-6067c0e0ec11` |
| TRD | admin_doc | ทำเอกสารวางบิลหาย / ผิดพลาด | 10 | ทำเอกสารวางบิลหาย / ผิดพลาด | `trd-57004737a966` |
| TRD | admin_doc | รับออเดอร์ตกหล่น / ตอบแชทช้า | 10 | รับออเดอร์ตกหล่น / ตอบแชทช้า | `trd-614b4990020f` |
| TRD | admin_doc | คีย์ข้อมูลสต๊อกเข้าระบบผิด | 10 | คีย์ข้อมูลสต๊อกเข้าระบบผิด | `trd-d8a0ce7d38b8` |
| TRD | cat_1787719959049 | จัดสินค้าผิด (แก้ไขทัน) | 5 | จัดสินค้าผิด | `trd-5c3880d2f7e2` |
| TRD | cat_1787719959049 | จัดสินค้าผิด (ถึงลูกค้าแล้ว) | 20 | จัดสินค้าผิด | `trd-5c3880d2f7e2` |
| TRD | cat_1787719959049 | ไม่ตรวจสอบสินค้าก่อนขึ้นรถ | 5 | ไม่ตรวจสอบสินค้าก่อนขึ้นรถ | `trd-8e59c893acd0` |
| TRD | cat_1787719959049 | ปล่อนสินค้าบนชั้นวางหมด | 5 | ปล่อนสินค้าบนชั้นวางหมด | `trd-9859151c8b29` |
| TRD | cat_1787719959049 | เช็คเกอร์ตรวจสอบสินค้าไม่ถูกต้อง | 10 | เช็คเกอร์ตรวจสอบสินค้าไม่ถูกต้อง | `trd-2bf2076b85e9` |

## Release and recovery

1. Reconcile current config snapshot, deployed RPC definitions/migration history and the independent Weekly LINE release. Secure private backups/checksums of affected config and Incident records before any mutation.
2. Apply only `20260908031355_kpi_impact_only_incidents.sql`; verify grants/RLS and disabled seed. Do not broadly push unrelated pending migrations.
3. Release dual-reader kpi-api and compatible Weekly reader, then the matching frontend assets/version. Verify both branches and mixed old/new reports before activation.
4. After release authorization and acceptance, set server catalog active with an exact activation timestamp. Verify new cases and stale-client rejection using approved operator tests.
5. If a mismatch occurs after v3 writes, set active false while retaining activatedAt, pause mutations and forward-fix. Never restore an old writer, delete new history or recalculate historical scores.

The database migration and API are deployed and the matching frontend is published. Deployed RPC checks passed for both branches with all probe writes rolled back; 261 backed-up historical daily records retained identical Incident and Workload data. Authenticated operator acceptance remains pending. See root Conductor plan `20260908-004` for detailed evidence and the existing strict TypeScript-check limitation.
