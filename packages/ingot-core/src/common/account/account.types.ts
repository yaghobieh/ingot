/** The signed-in Ingot account shown at the bottom of the left stripe (IDEA-92). Never holds tokens. */
export interface IngotAccount {
    readonly name: string;
    readonly email?: string;
}
