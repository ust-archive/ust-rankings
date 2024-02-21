export const SisUrl = String.raw`https://sisprod.psft.ust.hk/psp/SISPROD/EMPLOYEE/HRMS/c/SA_LEARNER_SERVICES.SSS_STUDENT_CENTER.GBL?pslnkid=Z_HC_SSS_STUDENT_CENTER_LNK&FolderPath=PORTAL_ROOT_OBJECT.Z_HC_SSS_STUDENT_CENTER_LNK&IsFolder=false&IgnoreParamTempl=FolderPath%2cIsFolder`;

const matcher = /^\w{3} \((\d{4})\)$/gm;
export const SisParser = {
  parse(sisString: string): number[] {
    const matches = [...sisString.matchAll(matcher)];
    return matches
      .map(it => it[1])
      .map(it => Number(it));
  },
};
