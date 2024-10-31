import { JettonMinter } from "../contracts/imports/JettonMinter"; // Импортируйте ваш контракт
import { assert } from "chai";

describe("Jetton Minter Tests", () => {
  let minter: JettonMinter;

  before(async () => {
    // Инициализация контракта перед тестами
    minter = new JettonMinter();
    await minter.deploy();
  });

  it("should mint tokens and deduct commission", async () => {
    const initialSupply = await minter.totalSupply();
    const initialBalance = await minter.getBalance(userAddress);

    // Запросите на создание токенов
    const amountToMint = 1000; // сумма токенов для мятия
    await minter.mint(userAddress, amountToMint);

    const expectedSupply = initialSupply + amountToMint * 0.15; // 15% от mint
    const expectedBalance = initialBalance + amountToMint * 0.15; // 15% от mint

    const finalSupply = await minter.totalSupply();
    const finalBalance = await minter.getBalance(userAddress);

    assert.equal(
      finalSupply,
      expectedSupply,
      "Total supply should reflect minted amount after commission."
    );
    assert.equal(
      finalBalance,
      expectedBalance,
      "User balance should reflect minted amount after commission."
    );
  });
});
