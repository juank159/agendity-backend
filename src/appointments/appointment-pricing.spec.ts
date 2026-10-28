import {
  centsToDecimal,
  priceLinesFor,
  priceLinesTotal,
} from './appointment-pricing';

describe('appointment-pricing (precio guardado en la cita, 2.29)', () => {
  it('cada servicio guarda su precio actual con 2 decimales y el total es la suma exacta', () => {
    const lines = priceLinesFor([
      { id: 'a', price: '0.10' },
      { id: 'b', price: 0.2 },
      { id: 'c', price: '25000' },
    ]);
    expect(lines).toEqual([
      { serviceId: 'a', price: '0.10' },
      { serviceId: 'b', price: '0.20' },
      { serviceId: 'c', price: '25000.00' },
    ]);
    expect(priceLinesTotal(lines)).toBe(25000.3); // sin 0.30000000000000004
  });

  it('al editar, los servicios que se conservan mantienen el precio guardado; los nuevos toman el actual', () => {
    const lines = priceLinesFor(
      [
        { id: 'a', price: '50000.00' }, // subió de precio en el catálogo
        { id: 'b', price: '8000.00' }, // nuevo en la cita
      ],
      new Map([
        ['a', '30000.00'],
        ['x', '1000.00'], // quitado: no aparece
      ]),
    );
    expect(lines).toEqual([
      { serviceId: 'a', price: '30000.00' },
      { serviceId: 'b', price: '8000.00' },
    ]);
    expect(priceLinesTotal(lines)).toBe(38000);
  });

  it('sin servicios el total es 0; centavos → decimal', () => {
    expect(priceLinesTotal([])).toBe(0);
    expect(centsToDecimal(123456)).toBe('1234.56');
  });
});
