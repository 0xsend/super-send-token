// Superfluid ABIs re-exports
// Mirrors import style used in:
// - scripts/wrapper/create.ts (SuperTokenFactory, ISuperToken)
// - test/wrapper.ts (ISuperfluid, IConstantFlowAgreementV1)

// NOTE: We intentionally re-use the package artifacts directly (no local ABI copies)
// to follow existing patterns and avoid introducing new conventions.

import SuperTokenFactoryJson from "@superfluid-finance/ethereum-contracts/build/truffle/SuperTokenFactory.json";
import ISuperTokenJson from "@superfluid-finance/ethereum-contracts/build/truffle/ISuperToken.json";
import ISuperfluidJson from "@superfluid-finance/ethereum-contracts/build/truffle/ISuperfluid.json";
import IConstantFlowAgreementV1Json from "@superfluid-finance/ethereum-contracts/build/truffle/IConstantFlowAgreementV1.json";

export const SuperTokenFactoryAbi = SuperTokenFactoryJson.abi as any[];
export const ISuperTokenAbi = ISuperTokenJson.abi as any[];
export const ISuperfluidAbi = (ISuperfluidJson as any).abi as any[];
export const IConstantFlowAgreementV1Abi = (IConstantFlowAgreementV1Json as any).abi as any[];

