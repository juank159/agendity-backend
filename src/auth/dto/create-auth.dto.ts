import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

export class CreateAuthDto {
    @ApiProperty({
        example: 'Juan',
        description: 'Nombre del usuario',
        required: true
    })
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty({
        example: 'Pérez',
        description: 'Apellido del usuario',
        required: true
    })
    @IsNotEmpty()
    @IsString()
    lastname: string;

    @ApiProperty({
        example: 'juan.perez@example.com',
        description: 'Correo electrónico del usuario',
        required: true,
        uniqueItems: true
    })
    @IsNotEmpty()
    @IsString()
    @IsEmail()
    email: string;

    @ApiProperty({
        example: '+573101234567',
        description: 'Número de teléfono del usuario',
        required: true,
        uniqueItems: true
    })
    @IsString()
    @IsNotEmpty()
    phone: string;

    @ApiProperty({
        example: 'Password123!',
        description: 'Contraseña del usuario (mínimo 6 caracteres)',
        required: true,
        minLength: 6
    })
    @IsString()
    @IsNotEmpty()
    @MinLength(6, { message: 'La contraseña debe tener minimo 6 caracteres' })
    password: string;

    @IsOptional()
    roles?: string[];
}