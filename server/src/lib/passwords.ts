import bcrypt from "bcryptjs";

const ROUNDS = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// Hash ficticio para igualar el tiempo de respuesta cuando el email no existe.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);
export const dummyVerify = (plain: string) => bcrypt.compare(plain, DUMMY_HASH);
