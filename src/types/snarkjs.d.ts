declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, string>,
      wasmPath: string,
      zkeyPath: string,
      logger?: any,
      wtnsCalc?: any,
      options?: any
    ): Promise<{ proof: any; publicSignals: string[] }>;
  };
}
