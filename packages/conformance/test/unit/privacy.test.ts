/** How the kit judges a Windows access list (H-16, D150 item 3), from real `Get-Acl` SDDL. */
import { describe, expect, it } from "vitest";
import { judgeSddl } from "../../src/privacy.ts";

const USER = "S-1-5-21-1-2-3-1001";
const OWNER_ONLY = `O:${USER}G:${USER}D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${USER})`;

describe("a Windows access list (H-16)", () => {
  it("is owner-only when protected and granting only the user and SYSTEM", () => {
    expect(judgeSddl(OWNER_ONLY, USER, true)).toBeUndefined();
    expect(
      judgeSddl(`O:BAG:SYD:PAI(A;OICI;FA;;;S-1-5-18)(A;OICI;FA;;;${USER})`, USER, true),
    ).toBeUndefined();
  });

  it("refuses a directory that inherits from above, but not a file inside one", () => {
    const inherited = `O:${USER}D:AI(A;ID;FA;;;SY)(A;ID;FA;;;${USER})`;
    expect(judgeSddl(inherited, USER, true)).toMatch(/inherits/);
    expect(judgeSddl(inherited, USER, false)).toBeUndefined();
  });

  it("refuses a grant to anyone else, Users, Administrators or another user", () => {
    for (const other of ["BU", "BA", "WD", "S-1-5-21-1-2-3-1002"]) {
      expect(judgeSddl(`${OWNER_ONLY}(A;OICI;0x1200a9;;;${other})`, USER, true)).toMatch(other);
    }
  });

  it("reads the built-in Administrator's alias as that user, and as no one else", () => {
    const admin = "S-1-5-21-1-2-3-500";
    const list = "O:BAG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;LA)";
    expect(judgeSddl(list, admin, true)).toBeUndefined();
    expect(judgeSddl(list, USER, true)).toMatch(/LA/);
  });

  it("refuses a NULL access list, for a file as for a directory (GPT review of WP-W3)", () => {
    for (const directory of [false, true]) {
      expect(judgeSddl(`O:${USER}G:${USER}D:NO_ACCESS_CONTROL`, USER, directory)).toMatch(/NULL/);
      expect(judgeSddl(`O:${USER}G:${USER}D:PNO_ACCESS_CONTROL`, USER, directory)).toMatch(
        /NULL|inherits/,
      );
    }
  });

  it("refuses a file with no access list at all", () => {
    expect(judgeSddl(`O:${USER}G:${USER}`, USER, false)).toMatch(/no access list/);
  });

  it("lets a deny entry stand", () => {
    expect(judgeSddl(`${OWNER_ONLY}(D;OICI;FA;;;WD)`, USER, true)).toBeUndefined();
  });
});
