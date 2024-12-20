import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsInt, IsString, Min, Max, MinLength } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID de la cita'
  })
  @IsNotEmpty()
  @IsUUID()
  appointment_id: string;

  @ApiProperty({
    example: 5,
    description: 'Calificación (1-5)',
    minimum: 1,
    maximum: 5
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiProperty({
    example: 'Excelente servicio, muy profesional y puntual',
    description: 'Comentario de la reseña'
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(10)
  comment: string;
}