export const PathAdvisor = {
  fromScheduleQuotaLocation(location: string): string | undefined {
    // The rules of Path Advisor are as follows:
    // if the name is like "Rm 1409, Lift 25-26 (60)", then it should be "ROOM 1409";
    // if the name is like "Lecture Theater A", then it should be "LTA";
    // if the name is like "G001, CYT Bldg", then it should be "CYTG001";
    // if the name is like "G001, LSK Bldg (70)", then it should be "LSKG001";
    // if the name is like "Rm 103, Shaw Auditorium", then it should be "SA103";
    // if the name is still like "Rm 1104, xxx", then it should be "ROOM 1104";
    // otherwise, return null.

    const reMainBuilding1 = /Rm (\w+), Lift (.*)/g;
    const reLT = /Lecture Theater (\w+)/g;
    const reCYT = /(\w+), CYT Bldg/g;
    const reLSK = /(\w+), LSK Bldg/g;
    const reSA = /Rm (\w+), Shaw Auditorium/g;
    const reMainBuilding2 = /Rm (\w+)/g;

    const reMainBuildingResult1 = reMainBuilding1.exec(location);
    if (reMainBuildingResult1) {
      return `${reMainBuildingResult1[1]}`;
    }

    const reLTResult = reLT.exec(location);
    if (reLTResult) {
      return `LT${reLTResult[1]}`;
    }

    const reCYTResult = reCYT.exec(location);
    if (reCYTResult) {
      return `CYT${reCYTResult[1]}`;
    }

    const reLSKResult = reLSK.exec(location);
    if (reLSKResult) {
      return `LSK${reLSKResult[1]}`;
    }

    const reSAResult = reSA.exec(location);
    if (reSAResult) {
      return `SA${reSAResult[1]}`;
    }

    const reMainBuilding2Result = reMainBuilding2.exec(location);
    if (reMainBuilding2Result) {
      return `${reMainBuilding2Result[1]}`;
    }

    return undefined;
  },

  /**
   * Find the path to a location (room of Schedule & Quota representation).
   * @param location
   */
  findPathTo(location: string): string | undefined {
    const path = PathAdvisor.fromScheduleQuotaLocation(location);
    if (path) {
      return `https://pathadvisor.ust.hk/interface.php?roomno=${path}`;
    }

    return undefined;
  },
};
