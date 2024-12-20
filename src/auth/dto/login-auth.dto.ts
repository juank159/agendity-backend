import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class LoginAuthDto {
    @ApiProperty({
        example: 'juan.perez@example.com',
        description: 'Correo electrónico del usuario registrado',
        required: true
    })
    @IsNotEmpty()
    @IsString()
    @IsEmail()
    email: string;

    @ApiProperty({
        example: 'Password123!',
        description: 'Contraseña de la cuenta',
        required: true
    })
    @IsNotEmpty()
    @IsString()
    password: string;
}